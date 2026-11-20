import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export const defaultWhisperModel = (home = homedir()) => join(home, ".local/share/instagram-reference-hub/models/ggml-small.bin");

/** A configuração explícita prevalece; descoberta automática reutiliza somente small. */
export function resolveWhisperModel(options: { home?: string; configured?: string } = {}): string {
  const home = options.home ?? homedir();
  const configured = options.configured ?? process.env.IRH_WHISPER_MODEL;
  const usable = (file: string) => { try { const s = statSync(file); return s.isFile() && s.size > 0; } catch { return false; } };
  if (configured) {
    if (!isAbsolute(configured) || !usable(configured)) throw new Error(`IRH_WHISPER_MODEL não aponta para um modelo válido: ${configured}`);
    return configured;
  }
  const candidates = [defaultWhisperModel(home), join(home, ".cache/hyperframes/whisper/models/ggml-small.bin"), join(home, "Library/Application Support/app.concat.editor/whisper-models/ggml-small.bin")];
  const found = candidates.find(usable);
  if (!found) throw new Error(`Modelo do Whisper não encontrado. Instale ggml-small.bin em ${candidates[0]} ou configure IRH_WHISPER_MODEL com o caminho absoluto de um modelo existente.`);
  return found;
}
