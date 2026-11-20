import type { Browser, Page } from "playwright-core";

// Browser-session sockets are private capabilities: never include them in error messages.
export function validateEndpoint(value: string): string {
  try {
    const u = new URL(value);
    if (u.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || !u.port || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(u.pathname)) throw new Error();
    return u.toString();
  } catch {
    throw new Error("Invalid local Chrome WebSocket endpoint; use a loopback browser-session socket.");
  }
}

export function endpointFromActivePort(value: string): string {
  const lines = value.trim().split(/\r?\n/);
  const port = Number(lines[0]);
  if (lines.length !== 2 || !/^\d+$/.test(lines[0]) || !Number.isInteger(port) || port < 1 || port > 65535 || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(lines[1])) throw new Error("Invalid DevToolsActivePort file; approve Chrome remote debugging and retry.");
  return validateEndpoint(`ws://127.0.0.1:${port}${lines[1]}`);
}

function isFlow(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "flow.google.com" || (u.hostname === "labs.google" && /^\/fx(?:\/|$)/.test(u.pathname)));
  } catch { return false; }
}

export async function findTargetPage(browser: Pick<Browser, "contexts">, targetId: string): Promise<Page> {
  if (!targetId) throw new Error("FLOW_MCP_TARGET_ID is required; choose the authenticated Flow tab explicitly.");
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const session = await context.newCDPSession(page).catch(() => null);
      if (!session) continue;
      let found = false;
      try {
        const { targetInfo } = await session.send("Target.getTargetInfo");
        found = targetInfo.targetId === targetId;
      } catch { /* A tab can close while the browser is enumerated. */ }
      finally { await session.detach().catch(() => {}); }
      if (!found) continue;
      if (!isFlow(page.url())) throw new Error("Configured target is not a Google Flow page. No other tab will be used.");
      return page;
    }
  }
  throw new Error("Configured Flow tab is unavailable. Re-select its target ID after checking the account; no replacement tab was opened.");
}
