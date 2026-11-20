import { constants, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { hashArquivo } from "./analise";
import { HttpError } from "./refs";

const REF_RE = /^REF-\d{4}-\d{2}-\d{4}$/;
const FRAME_RE = /^frames\/SHOT\d+_TAKE\d+\.\d+\.jpg$/;
type Take = { id: string; frame: string; still: string; ini: number; fim: number; t_frame?: number; frame_sha256?: string };
type Frame = { shot: string; take: string; still: string; frame: string; ini: number; fim: number; t_frame: number; sha256: string };
type Principal = { still: string; frame: string; arquivo: string; sha256: string; shots: string[] };
export type PacoteFrames = { ref: string; principais: string; todos: string; manifesto: string; total_shots: number; total_takes: number; total_imagens_base: number };
export type FinderOptions = { platform?: string; launch?: (args: string[]) => Promise<number> };

function semLink(path: string) {
  if (lstatSync(path).isSymbolicLink()) throw new HttpError(409, `Link simbólico não permitido na pasta de frames: ${basename(path)}`);
}

/** Derivado da segmentação: não escreve frames, análise, prompts ou status. */
export function prepararPacoteFrames(dir: string, ref: string): PacoteFrames {
  if (!REF_RE.test(ref)) throw new HttpError(400, "REF inválida");
  if (!existsSync(join(dir, "shots.json"))) throw new HttpError(409, "Segmente a referência antes de preparar os frames");
  semLink(dir); semLink(join(dir, "shots.json"));
  let seg: { ref: string; shots: { id: string; takes: Take[] }[]; analise_sha256?: string; analise_status?: string };
  try { seg = JSON.parse(readFileSync(join(dir, "shots.json"), "utf8")); }
  catch { throw new HttpError(409, "Segmentação inválida: shots.json não pôde ser lido"); }
  if (seg.ref !== ref) throw new HttpError(409, "REF da segmentação não corresponde à referência solicitada");
  if (!Array.isArray(seg.shots) || !seg.shots.length) throw new HttpError(409, "Segmentação sem cenas");
  if (!existsSync(join(dir, "frames"))) throw new HttpError(409, "Pasta de frames ausente: segmente novamente");
  semLink(join(dir, "frames"));
  if (existsSync(join(dir, "flow"))) semLink(join(dir, "flow"));
  const frames: Frame[] = [], firstStill = new Map<string, Frame>();
  const seenShots = new Set<string>(), seenTakes = new Set<string>();
  for (const shot of seg.shots) {
    if (!/^SHOT\d+$/.test(shot.id) || seenShots.has(shot.id) || !Array.isArray(shot.takes) || !shot.takes.length) throw new HttpError(409, "Segmentação com cena inválida ou sem takes");
    seenShots.add(shot.id);
    for (const t of shot.takes) {
      if (!/^TAKE\d+\.\d+$/.test(t.id) || seenTakes.has(t.id) || !/^STILL\d+$/.test(t.still)) throw new HttpError(409, "Segmentação com take/still inválido");
      if (typeof t.frame !== "string" || !FRAME_RE.test(t.frame) || basename(t.frame) !== `${shot.id}_${t.id}.jpg`) throw new HttpError(409, "Caminho de frame inválido");
      if (![t.ini, t.fim, t.t_frame ?? t.ini].every(Number.isFinite) || t.fim <= t.ini) throw new HttpError(409, "Tempo de frame inválido");
      const source = join(dir, t.frame);
      if (!existsSync(source)) throw new HttpError(409, `Frame ausente: ${t.frame}`);
      semLink(source);
      if (!lstatSync(source).isFile()) throw new HttpError(409, `Frame ausente: ${t.frame}`);
      const sha256 = hashArquivo(source);
      if (t.frame_sha256 && sha256 !== t.frame_sha256) throw new HttpError(409, `Hash divergente: ${t.frame}. Segmente novamente.`);
      const frame = { shot: shot.id, take: t.id, still: t.still, frame: t.frame, ini: t.ini, fim: t.fim, t_frame: t.t_frame ?? t.ini, sha256 };
      frames.push(frame); seenTakes.add(t.id);
      if (!firstStill.has(t.still)) firstStill.set(t.still, frame);
    }
  }
  const principais: Principal[] = [];
  for (const shot of seg.shots) {
    const still = shot.takes[0].still;
    const existing = principais.find(p => p.still === still);
    if (existing) { existing.shots.push(shot.id); continue; }
    const frame = firstStill.get(still)!;
    principais.push({ still, frame: frame.frame, arquivo: `flow/imagens-base/${basename(frame.frame)}`, sha256: frame.sha256, shots: [shot.id] });
  }
  const manifest = {
    versao: 1, ref, gerado_em: new Date().toISOString(), analise_status: seg.analise_status ?? "pendente", analise_sha256: seg.analise_sha256 ?? null,
    segmentacao_sha256: hashArquivo(join(dir, "shots.json")), total_shots: seg.shots.length, total_takes: frames.length, total_imagens_base: principais.length,
    pastas: { principais: "flow/imagens-base", todos: "frames" }, principais, takes: frames,
  };
  // Validar tudo antes de substituir o último lote completo. Cópias independentes evitam que editar o lote altere a fonte.
  const stage = mkdtempSync(join(dir, ".flow-stage-")), target = join(dir, "flow"), old = `${stage}-anterior`;
  try {
    mkdirSync(join(stage, "imagens-base"));
    for (const p of principais) copyFileSync(join(dir, p.frame), join(stage, "imagens-base", basename(p.frame)), constants.COPYFILE_FICLONE);
    writeFileSync(join(stage, "manifesto.json"), JSON.stringify(manifest, null, 2));
    writeFileSync(join(stage, "LEIA-ME.txt"), `${ref} — imagens de referência para Flow/Omni\n\nImagens-base: ${principais.length} arquivos para ${seg.shots.length} cenas. Arraste os JPEGs de imagens-base para o gerador. Os nomes correspondem aos anexos dos prompts.\nTodos os takes: ${frames.length} frames canônicos na pasta ../frames. O Hub também abre essa pasta.\nEstes arquivos são referências originais, não imagens geradas. A contact sheet do expert continua sendo um anexo separado.\nStatus da análise: ${manifest.analise_status}. Preparar este lote não aprova a análise nem gera mídia.\nRastreio completo de cenas, takes, timestamps e hashes: manifesto.json.\n`);
    if (existsSync(target)) renameSync(target, old);
    try { renameSync(stage, target); }
    catch (e) { if (existsSync(old)) renameSync(old, target); throw e; }
    rmSync(old, { recursive: true, force: true });
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return { ref, principais: join(target, "imagens-base"), todos: join(dir, "frames"), manifesto: join(target, "manifesto.json"), total_shots: seg.shots.length, total_takes: frames.length, total_imagens_base: principais.length };
}

export async function abrirPastaFrames(path: string, opts: FinderOptions = {}) {
  const plataforma = opts.platform ?? process.platform;
  if (plataforma !== "darwin" && plataforma !== "win32") throw new HttpError(501, "Abrir a pasta está disponível apenas no macOS e no Windows");
  if (plataforma === "win32" && !opts.launch) { if (!existsSync(path)) throw new HttpError(404, "Pasta de frames não encontrada"); Bun.spawn(["explorer.exe", path.replace(/\//g, "\\")]); return { path, aberta: true }; }
  if (!existsSync(path) || !lstatSync(path).isDirectory()) throw new HttpError(404, "Pasta de frames não encontrada");
  semLink(path);
  const launch = opts.launch ?? (async args => {
    const p = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" });
    await new Response(p.stderr).text();
    return await p.exited;
  });
  try { if (await launch(["open", path]) !== 0) throw new Error("saída diferente de zero"); }
  catch { throw new HttpError(500, "Não foi possível abrir a pasta no Finder. O lote continua disponível no disco."); }
  return { path, aberta: true };
}
