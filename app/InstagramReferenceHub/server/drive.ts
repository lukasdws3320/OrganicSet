// Importação por link do Google Drive (OrganicSet, 09/11/2026).
// Baixa o arquivo com a sessão do Chrome de geração (a mesma conta do Flow) e entrega à importação manual do Hub.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HttpError } from "./refs";

/** ID do arquivo num link do Drive: /file/d/<id>/…, open?id=<id>, uc?id=<id>, download?id=<id>. */
export function driveFileId(input: string): string | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (!/(^|\.)drive\.google\.com$|^drive\.usercontent\.google\.com$|^docs\.google\.com$/i.test(u.hostname)) return null;
  const m = u.pathname.match(/\/file\/d\/([A-Za-z0-9_-]{10,})/);
  const id = m?.[1] ?? u.searchParams.get("id");
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
}

export const isDriveUrl = (url: string) => driveFileId(url) !== null;

/** Porta de depuração do Chrome de geração (connection.json do controlador do Flow; padrão 9222). */
function cdpPort(): number {
  try {
    const f = process.env.FLOW_MCP_CONFIG || join(homedir(), ".config/google-flow-mcp/connection.json");
    return Number(JSON.parse(readFileSync(f, "utf8")).cdpPort) || 9222;
  } catch { return 9222; }
}

interface Cookie { name: string; value: string; domain: string; path: string }

/** Cookies do Google no Chrome de geração, lidos pelo CDP (Storage.getCookies). Nada é gravado em disco. */
async function googleCookies(): Promise<Cookie[]> {
  const port = cdpPort();
  let ws: string;
  try {
    ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(5000) })).json() as any).webSocketDebuggerUrl;
  } catch {
    throw new HttpError(503, `O Chrome de geração não está aberto (porta ${port}). Abra-o pelo controlador do Flow e tente de novo.`);
  }
  return await new Promise<Cookie[]>((resolve, reject) => {
    const sock = new WebSocket(ws);
    const timer = setTimeout(() => { sock.close(); reject(new HttpError(504, "O Chrome de geração não respondeu.")); }, 10_000);
    sock.onopen = () => sock.send(JSON.stringify({ id: 1, method: "Storage.getCookies" }));
    sock.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== 1) return;
      clearTimeout(timer); sock.close();
      if (msg.error) return reject(new HttpError(502, `CDP: ${msg.error.message}`));
      resolve((msg.result?.cookies ?? []).filter((c: Cookie) => /google\.com$/i.test(c.domain.replace(/^\./, ""))));
    };
    sock.onerror = () => { clearTimeout(timer); reject(new HttpError(502, "Falha ao ler a sessão do Chrome de geração.")); };
  });
}

function cookieHeader(cookies: Cookie[], url: URL): string {
  const host = url.hostname.toLowerCase();
  return cookies.filter((c) => {
    const d = c.domain.toLowerCase();
    const ok = d.startsWith(".") ? host === d.slice(1) || host.endsWith(d) : host === d;
    return ok && url.pathname.startsWith(c.path || "/");
  }).map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Baixa o arquivo do Drive para uma pasta temporária. Devolve o caminho e o nome original. */
export async function downloadDrive(root: string, url: string): Promise<{ dir: string; file: string; name: string }> {
  const id = driveFileId(url);
  if (!id) throw new HttpError(400, "Link do Drive inválido: use o link de compartilhamento do arquivo (/file/d/…).");
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(root, ".tmp", "drive-"));
  try {
    // Link público: baixa sem sessão. Privado: usa a sessão do Chrome de geração (mesma conta do Flow).
    const publico = await tentarBaixar(id, dir, []);
    if (publico) return publico;
    const cookies = await googleCookies();
    if (!cookies.length) throw new HttpError(401, "Arquivo privado e o Chrome de geração não está logado no Google.");
    const privado = await tentarBaixar(id, dir, cookies);
    if (privado) return privado;
    throw new HttpError(403, "O Drive não entregou o arquivo para a conta do Chrome de geração (sem acesso ou login expirado).");
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** Uma tentativa de download. null = o Drive devolveu página HTML (precisa de login). */
async function tentarBaixar(id: string, dir: string, cookies: Cookie[]): Promise<{ dir: string; file: string; name: string } | null> {
  {
    let next = new URL(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
    for (let hop = 0; hop < 8; hop++) {
      const res = await fetch(next, { redirect: "manual", headers: { Cookie: cookieHeader(cookies, next), "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(600_000) });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { next = new URL(loc, next); continue; }
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) throw new HttpError(502, `O Drive respondeu ${res.status} ao baixar o arquivo.`);
      if (type.startsWith("text/html")) return null;
      const disp = res.headers.get("content-disposition") ?? "";
      const name = decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disp.match(/filename="([^"]+)"/i)?.[1] ?? `${id}.mp4`);
      const file = join(dir, "entrada" + (name.match(/\.[A-Za-z0-9]{2,5}$/)?.[0]?.toLowerCase() ?? ".mp4"));
      await Bun.write(file, res);
      if (!existsSync(file)) throw new HttpError(502, "Download do Drive vazio.");
      return { dir, file, name };
    }
    throw new HttpError(502, "Redirecionamentos demais no Drive.");
  }
}
