import { createConnection } from "node:net";
import { existsSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import type { ConnectOverCDPTransport } from "playwright-core";

type Message = { id?: number; method?: string; params?: Record<string, any>; sessionId?: string };
type Request = (data: Record<string, unknown>) => Promise<any>;
type Options = { socketPath: string; targetId: string; leasePath: string };

// Windows: o browser-harness não usa socket Unix; grava {"port","token"} em bu-<nome>.port e exige o token em cada pedido.
function windowsEndpoint(socketPath: string): {port:number;token:string}|null {
  if (!socketPath.endsWith(".port")) return null;
  const d = JSON.parse(readFileSync(socketPath,"utf8"));
  return {port:Number(d.port),token:String(d.token)};
}

function ipcRequest(socketPath: string): Request {
  return data => new Promise((resolve, reject) => {
    let win: {port:number;token:string}|null = null;
    try { win = windowsEndpoint(socketPath); } catch { return reject(new Error("The existing Browser Harness daemon port file is unreadable. No Chrome connection was opened.")); }
    if (win) data = {...data, token: win.token};
    const socket = win ? createConnection({host:"127.0.0.1",port:win.port}) : createConnection({path:socketPath});
    let buffer = "";
    socket.setTimeout(10_000);
    const fail = () => { socket.destroy(); reject(new Error("The existing Browser Harness daemon is unavailable. No Chrome connection was opened.")); };
    socket.on("connect", () => socket.write(JSON.stringify(data) + "\n"));
    socket.on("error", fail); socket.on("timeout", fail);
    socket.on("data", chunk => {
      buffer += chunk.toString();
      if (buffer.length > 64 * 1024 * 1024) return fail();
      if (!buffer.includes("\n")) return;
      socket.destroy();
      try { const reply = JSON.parse(buffer.slice(0,buffer.indexOf("\n"))); if (reply.error) reject(new Error(String(reply.error))); else resolve(reply); } catch { fail(); }
    });
    socket.on("end", () => { if (!buffer.includes("\n")) fail(); });
  });
}

function acquireLease(path: string): () => void {
  // Local bridge processes share one event consumer. The user's CLI must remain idle while this lease is held.
  if (existsSync(path)) {
    let alive = true;
    try { const {pid} = JSON.parse(readFileSync(path,"utf8")); if (Number.isInteger(pid) && pid > 1) { try { process.kill(pid,0); } catch(error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; } } } catch { /* Unknown owner fails closed. */ }
    if (alive) throw new Error("Browser Harness event feed requires an exclusive bridge owner; another bridge is active.");
    unlinkSync(path);
  }
  const fd = openSync(path,"wx",0o600);
  writeFileSync(fd,JSON.stringify({pid:process.pid}));closeSync(fd);
  let released = false;
  return () => {if(released)return;released=true;try{const {pid}=JSON.parse(readFileSync(path,"utf8"));if(pid===process.pid)unlinkSync(path);}catch{}};
}

export async function createHarnessTransport(options: Options): Promise<ConnectOverCDPTransport> {
  if (!options.targetId) throw new Error("Exact Flow tab target ID is required.");
  if (!existsSync(options.socketPath)) throw new Error("The existing Browser Harness daemon socket is missing. No Chrome connection was opened.");
  const request = ipcRequest(options.socketPath);
  const ping = await request({meta:"ping"});
  if (ping.pong !== true) throw new Error("The existing Browser Harness daemon could not be verified.");
  const status = await request({meta:"connection_status"});
  if (status.target_id !== options.targetId || !status.session_id) throw new Error("The existing Browser Harness must already control the exact Flow tab; no tab or session was changed.");
  const {result} = await request({method:"Target.getTargetInfo",params:{targetId:options.targetId}});
  const targetInfo = result?.targetInfo;
  const u = new URL(targetInfo?.url ?? "about:blank");
  if (targetInfo?.targetId !== options.targetId || targetInfo.type !== "page" || u.protocol !== "https:" || !(u.hostname === "flow.google.com" || (u.hostname === "labs.google" && /^\/fx(?:\/|$)/.test(u.pathname)))) throw new Error("The exact Flow tab is no longer available in the existing Browser Harness.");
  const release = acquireLease(options.leasePath);
  return new HarnessTransport(request,targetInfo,status.session_id,release);
}

class HarnessTransport implements ConnectOverCDPTransport {
  onmessage?: (message: object) => void;
  onclose?: (reason?: string) => void;
  private closed = false;
  private announced = false;
  private timer?: NodeJS.Timeout;
  private virtualId = 0;
  private readonly pageSession = "flow-bridge-page";
  private readonly virtualSessions = new Set(["flow-bridge-page"]);
  constructor(private request: Request,private target: Record<string,any>,private approvedSession: string,private release:()=>void) {}
  send(message: object): void {
    const m = message as Message;
    void this.dispatch(m).then(result => {if(!this.closed)this.onmessage?.({id:m.id,...(m.sessionId?{sessionId:m.sessionId}:{}),result});}, error => {if(!this.closed)this.onmessage?.({id:m.id,...(m.sessionId?{sessionId:m.sessionId}:{}),error:{code:-32000,message:error instanceof Error?error.message:"Harness command failed"}});});
  }
  private async dispatch(m: Message): Promise<any> {
    if(this.closed)throw new Error("Local Harness transport is closed.");
    const method=m.method??"",params=m.params??{};
    if(m.sessionId&&!this.virtualSessions.has(m.sessionId))throw new Error("Unknown local Flow bridge session.");
    if(method==="Target.setAutoAttach") {
      // Playwright normally attaches every open tab. This bridge advertises ONLY the approved existing Flow session.
      if(!m.sessionId&&!this.announced&&params.autoAttach){
        this.announced=true;
        this.onmessage?.({method:"Target.attachedToTarget",params:{sessionId:this.pageSession,targetInfo:{...this.target,browserContextId:this.target.browserContextId??"flow-existing-context",attached:true},waitingForDebugger:false}});
        void this.poll();
      }
      return {};
    }
    if(method==="Target.getTargetInfo") {if(params.targetId&&params.targetId!==this.target.targetId)throw new Error("Only the configured Flow target is allowed.");return {targetInfo:this.target};}
    if(method==="Target.getTargets")return {targetInfos:[this.target]};
    if(method==="Target.getBrowserContexts")return {browserContextIds:[]};
    if(method==="Target.attachToBrowserTarget"||method==="Target.attachToTarget") {
      if(method==="Target.attachToTarget"&&params.targetId!==this.target.targetId)throw new Error("Only the configured Flow target is allowed.");
      const sessionId=`flow-bridge-raw-${++this.virtualId}`;this.virtualSessions.add(sessionId);return {sessionId};
    }
    if(method==="Target.detachFromTarget") {if(params.sessionId!==this.pageSession)this.virtualSessions.delete(params.sessionId);return {}; }
    if(method.startsWith("Target."))throw new Error("Browser target mutations are disabled; reuse the configured Flow tab.");
    if(method==="Browser.close")throw new Error("The user's Chrome and Harness daemon must stay open.");
    // All actual commands stay on the daemon's already-authorized page session, never its mutable default.
    return (await this.request({method,params,session_id:this.approvedSession})).result ?? {};
  }
  private async poll(): Promise<void> {
    if(this.closed)return;
    try {
      const {events=[]}=await this.request({meta:"drain_events"});
      if(this.closed)return;
      for(const event of events) {
        if(event.session_id!==this.approvedSession)continue;
        if(event.method.startsWith("Target."))continue;
        const browserEvent=event.method.startsWith("Browser.");
        this.onmessage?.({method:event.method,params:event.params,...(browserEvent?{}:{sessionId:this.pageSession})});
      }
    } catch {this.close("Existing Browser Harness disconnected; reconnect it manually before retrying.");return;}
    if(!this.closed)this.timer=setTimeout(()=>void this.poll(),40);
  }
  close(reason?: string): void {
    if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.release();
    // Never send shutdown, detachFromTarget, Browser.close or open another browser connection.
    this.onclose?.(reason);
  }
}
