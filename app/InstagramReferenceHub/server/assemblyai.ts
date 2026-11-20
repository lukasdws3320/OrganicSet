import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type PalavraAssembly = { w: string; ini: number; fim: number };
const BASE = "https://api.assemblyai.com";

export const assemblyKeyFile = (home = homedir()) => join(home, ".config/instagram-reference-hub/assemblyai.env");

/** Chave só do ambiente ou do arquivo privado (600) fora do repositório; nunca de argumento ou nota. */
export function assemblyKey(options: { env?: string; home?: string } = {}): string | null {
  const env = (options.env ?? process.env.ASSEMBLYAI_API_KEY)?.trim();
  if (env) return env;
  const file = assemblyKeyFile(options.home);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").match(/^\s*ASSEMBLYAI_API_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1] ?? null;
}

/** IRH_TRANSCRIBER=assemblyai|whisper força o motor; sem a variável, AssemblyAI quando houver chave. */
export function escolherTranscritor(options: { configured?: string; key?: string | null } = {}): { motor: "assemblyai" | "whisper"; forcado: boolean } {
  const configured = (options.configured ?? process.env.IRH_TRANSCRIBER)?.trim().toLowerCase();
  if (configured && configured !== "assemblyai" && configured !== "whisper") throw new Error(`IRH_TRANSCRIBER inválido: ${configured}`);
  if (configured) return { motor: configured as "assemblyai" | "whisper", forcado: true };
  const key = options.key === undefined ? assemblyKey() : options.key;
  return { motor: key ? "assemblyai" : "whisper", forcado: false };
}

export function palavrasAssembly(words: { text: string; start: number; end: number }[] = []): PalavraAssembly[] {
  return words.map((x) => ({ w: String(x.text).trim(), ini: x.start / 1000, fim: x.end / 1000 })).filter((p) => p.w);
}

export async function transcreverAssembly(audio: string, idioma: string, key: string, fetchImpl: typeof fetch = fetch, pollMs = 3000): Promise<PalavraAssembly[]> {
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetchImpl(BASE + path, { ...init, headers: { authorization: key, ...(init.headers ?? {}) } });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`AssemblyAI ${r.status}: ${String(j.error ?? "").slice(0, 200)}`);
    return j;
  };
  const { upload_url } = await call("/v2/upload", { method: "POST", body: readFileSync(audio), headers: { "content-type": "application/octet-stream" } });
  const job = await call("/v2/transcript", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ audio_url: upload_url, ...(idioma === "auto" ? { language_detection: true } : { language_code: idioma }), punctuate: true, format_text: true }) });
  const deadline = Date.now() + 15 * 60_000;
  while (Date.now() < deadline) {
    const t = await call(`/v2/transcript/${job.id}`);
    if (t.status === "completed") return palavrasAssembly(t.words);
    if (t.status === "error") throw new Error(`AssemblyAI falhou: ${String(t.error).slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error("AssemblyAI não concluiu a transcrição em 15 min");
}
