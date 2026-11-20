// Segmentação de uma referência em SHOTs e TAKEs (vocabulário do setup de clonagem da OP 001):
//   SHOT = 1 geração contínua de vídeo (envelope da engine), cortado SEMPRE em fim de oração,
//          silêncio real ou corte de câmera — vírgula NÃO é fronteira se a fala inteira couber.
//   TAKE = trecho visual dentro do shot (cada corte de câmera abre um take novo) → TAKE<NN>.<k>, com frame-âncora.
//   SETUP = enquadramento visual; takes do mesmo setup compartilham o mesmo STILL (economia de stills).
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prepararPacoteFrames } from "./pacote-frames";
import { chaveEstado, hashArquivo, lerAnalise, verificarEvidencias } from "./analise";
import { divisaoIndevida } from "./replicacao-prompts";
import { defaultWhisperModel, resolveWhisperModel } from "./whisper";
import { assemblyKey, escolherTranscritor, transcreverAssembly } from "./assemblyai";

export type Palavra = { w: string; ini: number; fim: number };
export type Params = { limiar: number; max_shot: number; max_palavras: number; pausa: number; silencio: number; setup_diff: number; idioma: string; por_cortes?: boolean };
// Envelope mais largo entre as engines em uso (Omni 10s / 30 palavras). O gate por engine
// fica no lint: rodar em Veo um shot de 10s gera erro explícito, nunca fala picotada silenciosa.
export const PARAMS: Params = { limiar: 0.3, max_shot: 10, max_palavras: 30, pausa: 0.35, silencio: 1.0, setup_diff: 14, idioma: process.env.IRH_TRANSCRICAO_IDIOMA || "pt" };
// Windows não tem `rm`: apagar pelo próprio Node (OrganicSet, 09/11/2026).
const apagar = (file: string) => { try { unlinkSync(file); } catch { /* já não existe */ } };

type ShotBruto = { ini: number; fim: number; palavras: Palavra[]; mudo: boolean; forcado: boolean };

// Força da fronteira entre a palavra i e a i+1. Fim de frase > vírgula/pausa > nada.
function forca(ws: Palavra[], i: number, cortes: number[], p: Params): number {
  const a = ws[i], b = ws[i + 1];
  const gap = b.ini - a.fim;
  let s = 0;
  if (/[.!?…]["”)]?$/.test(a.w)) s = 3;
  else if (/[,;:]$/.test(a.w)) s = 2;
  if (gap >= 0.5) s = Math.max(s, 3);
  else if (gap >= p.pausa) s = Math.max(s, 2);
  else if (gap >= 0.2) s = Math.max(s, 1);
  if (s > 0 && cortes.some((c) => c >= a.fim - 0.25 && c <= b.ini + 0.25)) s += 1; // fronteira que coincide com corte de câmera
  return s;
}

// Agrupa palavras em shots: o shot vai o mais longe possível dentro do teto e corta na fronteira mais forte
// disponível (nunca no meio de expressão quando existe vírgula/pausa). Só corta "a seco" se não houver fronteira.
export function segmentarFala(ws: Palavra[], cortes: number[], duracao: number, p: Params = PARAMS): ShotBruto[] {
  const out: ShotBruto[] = [];
  let i = 0;
  while (i < ws.length) {
    const t0 = ws[i].ini;
    let j = i; // último índice que cabe no teto
    while (j + 1 < ws.length && ws[j + 1].fim - t0 <= p.max_shot && ws[j + 1].ini - ws[j].fim < p.silencio) j++;
    let fim = j, forcado = false;
    if (j + 1 < ws.length && ws[j + 1].ini - ws[j].fim < p.silencio) {
      // Não terminou em silêncio: escolher a melhor fronteira em [i..j-1] (empate → a mais tardia).
      let best = -1, bestS = 0;
      for (let k = i; k < j; k++) { const s = forca(ws, k, cortes, p); if (s >= bestS && s > 0) { best = k; bestS = s; } }
      // Fronteira fraca muito no começo deixa um shot minúsculo; aceita só se o shot tiver ≥ 40% do teto.
      if (best >= 0 && (bestS >= 2 || ws[best].fim - t0 >= p.max_shot * 0.4)) fim = best;
      else forcado = true;
      if (forca(ws, j, cortes, p) >= 2 && fim < j && bestS < 3) fim = j; // a própria borda do teto é boa
    }
    out.push({ ini: t0, fim: ws[fim].fim, palavras: ws.slice(i, fim + 1), mudo: false, forcado });
    i = fim + 1;
  }
  // Sobra final de fala com menos de 1 s vira geração impossível de provar por quadro (OrganicSet, 09/11/2026):
  // junta ao trecho anterior quando o conjunto ainda cabe no teto físico do Veo (8 s).
  const ult = out.at(-1), pen = out.at(-2);
  if (ult && pen && Math.min(ult.fim, duracao) - ult.ini < 1 && duracao - pen.ini <= 8) {
    pen.fim = ult.fim; pen.palavras.push(...ult.palavras); pen.forcado ||= ult.forcado; out.pop();
  }
  // Janelas contínuas: fronteira no meio do vão (ou no corte de câmera dentro dele). Vão longo vira shot mudo.
  const shots: ShotBruto[] = [];
  out.forEach((s, k) => {
    const prox = out[k + 1];
    if (k === 0) s.ini = 0;
    if (!prox) { s.fim = duracao; shots.push(s); return; }
    const gap = prox.ini - s.fim;
    const corteNoVao = cortes.find((c) => c > s.fim && c < prox.ini);
    if (gap >= p.silencio) {
      const a = s.fim + 0.15, b = prox.ini - 0.15;
      s.fim = a; prox.ini = b;
      shots.push(s, { ini: a, fim: b, palavras: [], mudo: true, forcado: false });
      return;
    }
    const meio = corteNoVao ?? (s.fim + prox.ini) / 2;
    s.fim = meio; prox.ini = meio;
    shots.push(s);
  });
  if (!ws.length) shots.push({ ini: 0, fim: duracao, palavras: [], mudo: true, forcado: false });
  return shots;
}

/** Um trecho por corte de câmera (formato TROCA DE PRODUTO: a fala será reescrita, o ritmo visual manda).
 *  Corte acima do teto é dividido numa fronteira de fala perto do meio (fim de frase > pausa), sem cortar palavra. */
export const TETO_CORTE = 8.1; // clipe Veo de 8 s; até 8,1 s a edição estica <1,3%, imperceptível
export function segmentarPorCortes(ws: Palavra[], cortes: number[], duracao: number, _p: Params = PARAMS): ShotBruto[] {
  const p = { ..._p, max_shot: TETO_CORTE };
  const bordas = [0, ...cortes.filter((c) => c > 0.3 && c < duracao - 0.3).sort((a, b) => a - b), duracao];
  const janelas: [number, number][] = [];
  for (let i = 0; i < bordas.length - 1; i++) {
    let [a, b] = [bordas[i], bordas[i + 1]];
    while (b - a > p.max_shot + 0.01) {
      const partes = Math.ceil((b - a) / p.max_shot), alvo = a + (b - a) / partes;
      const cands: { t: number; s: number }[] = [];
      for (let k = 0; k + 1 < ws.length; k++) {
        const t = (ws[k].fim + ws[k + 1].ini) / 2;
        if (t <= a + 1.2 || t >= b - 1.2 || t - a > 8 || b - t > 8 * (partes - 1) || ws[k].fim < a) continue;
        const s = /[.!?…]["”)]?$/.test(ws[k].w) ? 3 : /[,;:]$/.test(ws[k].w) ? 2 : ws[k + 1].ini - ws[k].fim >= p.pausa ? 1 : 0;
        if (s) cands.push({ t, s });
      }
      const melhor = cands.sort((x, y) => y.s - x.s || Math.abs(x.t - alvo) - Math.abs(y.t - alvo))[0];
      const corte = melhor ? Math.round(melhor.t * 1000) / 1000 : alvo;
      janelas.push([a, corte]); a = corte;
    }
    janelas.push([a, b]);
  }
  return janelas.map(([ini, fim]) => {
    const palavras = ws.filter((w) => (w.ini + w.fim) / 2 >= ini && (w.ini + w.fim) / 2 < fim);
    return { ini, fim, palavras, mudo: !palavras.length, forcado: false };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");
const texto = (ws: Palavra[]) => ws.map((w) => w.w).join(" ").replace(/\s+([,.!?…])/g, "$1").trim();

async function run(cmd: string[]): Promise<{ out: string; err: string; code: number }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { out, err, code: await p.exited };
}

export const WHISPER_MODEL = process.env.IRH_WHISPER_MODEL ?? defaultWhisperModel();

// Motor primário: AssemblyAI (timestamps por palavra). Whisper local é fallback registrado em `fonte`, nunca troca silenciosa.
async function transcrever(video: string, dir: string, idioma: string): Promise<Palavra[]> {
  const cache = join(dir, "transcricao.json");
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8")).palavras;
  const escolha = escolherTranscritor();
  const model = escolha.motor === "whisper" ? resolveWhisperModel() : null;
  const wav = join(dir, ".audio.wav");
  const audio = await run(["ffmpeg", "-v", "error", "-y", "-i", video, "-ar", "16000", "-ac", "1", wav]);
  if (audio.code !== 0) throw new Error(`Falha ao preparar áudio para transcrição: ${audio.err.slice(-400)}`);
  try {
    if (escolha.motor === "assemblyai") {
      const key = assemblyKey();
      if (!key) throw new Error("IRH_TRANSCRIBER=assemblyai sem ASSEMBLYAI_API_KEY nem ~/.config/instagram-reference-hub/assemblyai.env");
      try {
        const palavras = await transcreverAssembly(wav, idioma, key);
        writeFileSync(cache, JSON.stringify({ fonte: "assemblyai", idioma, palavras }, null, 1));
        return palavras;
      } catch (e: any) {
        if (escolha.forcado) throw e;
        const palavras = await whisperLocal(wav, dir, idioma, resolveWhisperModel());
        writeFileSync(cache, JSON.stringify({ fonte: "whisper.cpp small", fallback_de: "assemblyai", motivo: String(e?.message ?? e).slice(0, 300), idioma, palavras }, null, 1));
        return palavras;
      }
    }
    const palavras = await whisperLocal(wav, dir, idioma, model!);
    writeFileSync(cache, JSON.stringify({ fonte: "whisper.cpp small", idioma, palavras }, null, 1));
    return palavras;
  } finally {
    apagar(wav);
  }
}

export async function whisperLocal(wav: string, dir: string, idioma: string, model: string): Promise<Palavra[]> {
  const base = join(dir, ".whisper");
  const r = await run(["whisper-cli", "-m", model, "-l", idioma, "-ml", "1", "-sow", "-oj", "-of", base, "-f", wav]);
  if (r.code !== 0) throw new Error(`whisper-cli falhou: ${r.err.slice(-400)}`);
  const j = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  apagar(`${base}.json`);
  const palavras: Palavra[] = (j.transcription ?? [])
    .map((s: any) => ({ w: String(s.text).trim(), ini: s.offsets.from / 1000, fim: s.offsets.to / 1000 }))
    .filter((p: Palavra) => p.w && !/^\[.*\]$/.test(p.w));
  // Com timestamps por palavra o Whisper quase não pontua; sem timestamps (-nt) ele pontua. A segmentação precisa
  // de fim de frase: uma segunda leitura só de texto empresta a pontuação, sem mexer em tempos nem palavras (OrganicSet, 09/11/2026).
  const txt = await run(["whisper-cli", "-m", model, "-l", idioma, "-nt", "-np", "-f", wav]);
  return txt.code === 0 ? pontuarPalavras(palavras, txt.out) : palavras;
}

/** Copia pontuação/maiúscula do texto corrido para as palavras com tempo, por alinhamento (maior subsequência comum). */
export function pontuarPalavras(ws: Palavra[], texto: string): Palavra[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}']+/gu, "");
  const toks = texto.split(/\s+/).map((t) => t.trim()).filter((t) => norm(t));
  const a = ws.map((w) => norm(w.w)), b = toks.map(norm), n = a.length, m = b.length;
  if (!n || !m || n * m > 4e6) return ws;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let k = m - 1; k >= 0; k--) dp[i][k] = a[i] === b[k] ? dp[i + 1][k + 1] + 1 : Math.max(dp[i + 1][k], dp[i][k + 1]);
  const out = ws.map((w) => ({ ...w }));
  for (let i = 0, k = 0; i < n && k < m;) {
    if (a[i] === b[k]) {
      const fim = toks[k].match(/[,;:.!?…]+["”)]?$/)?.[0] ?? "";
      if (fim && !/[,;:.!?…]$/.test(out[i].w)) out[i].w += fim;
      i++; k++;
    } else if (dp[i + 1][k] >= dp[i][k + 1]) i++; else k++;
  }
  return out;
}

async function cortesVisuais(video: string, limiar: number): Promise<number[]> {
  const r = await run(["ffmpeg", "-hide_banner", "-i", video, "-vf", `select='gt(scene,${limiar})',showinfo`, "-an", "-f", "null", "-"]);
  return [...r.err.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

// Assinatura maior com veto regional: objeto pequeno não se dilui na média global.
export function regioesCompativeis(a: Uint8Array,b: Uint8Array,limiar: number) {
  if (a.length!==96*168 || b.length!==a.length) return false;
  for (let ry=0;ry<3;ry++) for(let rx=0;rx<3;rx++) {
    let total=0;
    for(let y=ry*56;y<(ry+1)*56;y++) for(let x=rx*32;x<(rx+1)*32;x++) total+=Math.abs(a[y*96+x]-b[y*96+x]);
    if (total/(32*56)>limiar) return false;
  }
  return true;
}
async function assinatura(img: string): Promise<Uint8Array> {
  const p = Bun.spawn(["ffmpeg", "-v", "error", "-i", img, "-vf", "scale=96:168,format=gray", "-f", "rawvideo", "-"], { stdout: "pipe" });
  return new Uint8Array(await new Response(p.stdout).arrayBuffer());
}
const dif = (a: Uint8Array, b: Uint8Array) => a.reduce((s, v, i) => s + Math.abs(v - (b[i] ?? 0)), 0) / a.length;

/** O Whisper às vezes marca as últimas palavras depois do fim do vídeo (desvio de timestamp, OrganicSet 09/11/2026).
 *  Comprime só esse excesso para dentro da duração real e grava no cache, para todas as etapas lerem os mesmos tempos. */
export function limitarAoVideo(ws: Palavra[], duracao: number, cache?: string): Palavra[] {
  const fora = ws.findIndex((w) => w.fim > duracao + 0.01);
  if (fora < 0 || !Number.isFinite(duracao)) return ws;
  const ini = Math.min(ws[fora].ini, duracao - 0.05 * (ws.length - fora)), fimOrig = ws.at(-1)!.fim, escala = (duracao - ini) / Math.max(fimOrig - ws[fora].ini, 0.001);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const out = ws.map((w, i) => i < fora ? w : { ...w, ini: r3(ini + (w.ini - ws[fora].ini) * escala), fim: r3(Math.min(duracao, ini + (w.fim - ws[fora].ini) * escala)) });
  if (cache && existsSync(cache)) {
    const j = JSON.parse(readFileSync(cache, "utf8"));
    writeFileSync(cache, JSON.stringify({ ...j, palavras: out, ajuste_fim: { duracao, palavras_ajustadas: ws.length - fora, fim_original: fimOrig } }, null, 1));
  }
  return out;
}

export async function segmentar(opts: { ref: string; video: string; dir: string; duracao: number; params?: Partial<Params> }) {
  const p = { ...PARAMS, ...opts.params };
  mkdirSync(join(opts.dir, "frames"), { recursive: true });
  const analise=lerAnalise(opts.dir);
  if (analise) verificarEvidencias(analise,opts.dir,opts.video,opts.ref,opts.duracao);
  const [brutasAsr, cortes] = await Promise.all([transcrever(opts.video, opts.dir, p.idioma), cortesVisuais(opts.video, p.limiar)]);
  const palavras = limitarAoVideo(brutasAsr, opts.duracao, join(opts.dir, "transcricao.json"));
  let cursor=0;
  const brutos = analise ? analise.shots.map(s=>{
    const n=s.fala.trim().split(/\s+/).filter(Boolean).length;
    const ws=palavras.slice(cursor,cursor+n);cursor+=n;
    if(texto(ws)!==s.fala)throw new Error(`${s.id}: fala do mapa diverge da transcrição`);
    return {ini:s.ini,fim:s.fim,palavras:ws,mudo:!s.fala,forcado:false};
  }) : p.por_cortes ? segmentarPorCortes(palavras, cortes, opts.duracao, p) : segmentarFala(palavras, cortes, opts.duracao, p);
  if(analise && cursor!==palavras.length)throw new Error("Mapa descartou palavras da transcrição");
  if(analise)for(const [i,s]of brutos.entries()){
    const antShot=brutos[i-1],ant=antShot?.palavras.at(-1);
    if(!antShot||!ant)continue;
    const cortou=cortes.some(c=>Math.abs(c-s.ini)<.15);
    if(!/[,;:.!?…]["”)]?$/.test(ant.w)&&!cortou)throw new Error(`${analise.shots[i].id}: fronteira no meio de expressão`);
    // Vírgula só é fronteira quando a fala NÃO caberia junta. Se cabe, o mapa está picotando a locução.
    const div=divisaoIndevida({fala:texto(antShot.palavras),ini:antShot.ini,fim:antShot.fim},{fala:texto(s.palavras),ini:s.ini,fim:s.fim},cortes,{s:analise.conferencia?.envelope_segundos??10,palavras:30});
    if(div)throw new Error(`${analise.shots[i-1].id}→${analise.shots[i].id}: fala contínua partida — ${div.palavras} palavras em ${div.segundos.toFixed(2)}s cabem em uma única geração de ${analise.conferencia?.envelope_segundos??10}s; una os shots e abra TAKEs`);
  }

  // Só substituir frames depois da transcrição e das verificações: falha de dependência preserva a análise anterior.
  for (const f of readdirSync(join(opts.dir,"frames"))) if (/^SHOT\d+_TAKE\d+\.\d+\.jpg$/.test(f)) unlinkSync(join(opts.dir,"frames",f));
  const sigs: { setup: string; sig: Uint8Array; estado?: string }[] = [];
  const stillDoSetup = new Map<string, string>();
  const shots = [];
  for (const [n, s] of brutos.entries()) {
    const id = `SHOT${pad(n + 1)}`;
    const mapa=analise?.shots[n];
    const bordas = mapa ? [...mapa.estados.map(e=>e.ini),s.fim] : [s.ini,...cortes.filter(c=>c>s.ini+.08&&c<s.fim-.08),s.fim];
    const takes = [];
    for (let k = 0; k < bordas.length - 1; k++) {
      const ini = bordas[k], fim = bordas[k + 1];
      const estado=mapa?.estados.find(e=>ini>=e.ini-.02 && ini<e.fim-.01);
      const tf = estado && estado.t_frame>=ini && estado.t_frame<fim ? estado.t_frame : Math.min(ini + 0.15, (ini + fim) / 2);
      const tid = `TAKE${pad(n + 1)}.${k + 1}`;
      const frame = `frames/${id}_${tid}.jpg`;
      // Instante no fim do vídeo (ou depois do último frame real) não devolve imagem: recua até achar um frame do próprio take.
      const fimReal=Math.min(fim, opts.duracao);
      const candidatos=[...new Set([tf, Math.min(tf, fimReal-0.08), (ini+fimReal)/2, ini, Math.max(0, fimReal-0.25)].map((x)=>r2(Math.max(0,x))))];
      let extraido={code:1,err:""}, tUsado=tf;
      for (const instante of candidatos) {
        tUsado=instante;
        extraido=await run(["ffmpeg", "-v", "error", "-y", "-ss", String(instante), "-i", opts.video, "-frames:v", "1", "-q:v", "3", join(opts.dir, frame)]);
        if (!extraido.code && existsSync(join(opts.dir,frame))) break;
      }
      if (extraido.code || !existsSync(join(opts.dir,frame))) throw new Error(`Falha ao extrair ${tid}: ${extraido.err.slice(-300)}`);
      const sig = await assinatura(join(opts.dir, frame));
      const chave=estado&&mapa?chaveEstado(estado,mapa.angulo):undefined;
      let setup = sigs.find(x=> chave ? x.estado===chave : !x.estado && dif(x.sig,sig)<=p.setup_diff && regioesCompativeis(x.sig,sig,p.setup_diff))?.setup;
      if (!setup) { setup = `S${pad(sigs.length+1)}`; sigs.push({ setup, sig, estado:chave }); }
      if (!stillDoSetup.has(setup)) stillDoSetup.set(setup, `STILL${pad(stillDoSetup.size + 1)}`);
      const ws = s.palavras.filter((w) => w.ini >= ini - 0.05 && w.ini < fim);
      takes.push({ id: tid, ini: r2(ini), fim: r2(fim), t_frame: r2(tUsado), frame, setup, fala: texto(ws), still: stillDoSetup.get(setup), frame_sha256: hashArquivo(join(opts.dir,frame)), estado: chave, estado_visual: estado, angulo: mapa?.angulo });
    }
    shots.push({ id, ini: r2(s.ini), fim: r2(s.fim), duracao: r2(s.fim - s.ini), fala: texto(s.palavras), palavras: s.palavras.length, mudo: s.mudo, corte_forcado: s.forcado, takes });
  }

  // Contact sheet dos takes, na ordem (1 imagem pra análise visual barata).
  const frames = shots.flatMap((s) => s.takes.map((t) => join(opts.dir, t.frame)));
  const lista = join(opts.dir, ".frames.txt");
  writeFileSync(lista, frames.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const cols = Math.min(6, frames.length);
  await run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lista, "-vf", `scale=240:-1,tile=${cols}x${Math.ceil(frames.length / cols)}`, "-frames:v", "1", join(opts.dir, "sheet.jpg")]);
  apagar(lista);

  const out = {
    versao: 3, analise_sha256: analise ? hashArquivo(join(opts.dir,"analise.json")) : null, analise_status: analise ? "conferida" : "pendente", ref: opts.ref, video: opts.video, duracao: r2(opts.duracao), gerado_em: new Date().toISOString(), parametros: p,
    transcricao: "transcricao.json", cortes: cortes.map(r2), cortes_visuais: cortes.length, setups: sigs.length, stills: stillDoSetup.size, shots,
  };
  writeFileSync(join(opts.dir, "shots.json"), JSON.stringify(out, null, 1));
  prepararPacoteFrames(opts.dir, opts.ref);
  return out;
}
