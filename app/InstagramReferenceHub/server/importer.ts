import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { now } from "./db";
import { getSettings } from "./catalog";
import { canonicalUrl, extractCta, extractHashtags, parseShortcode, refId, videoFileName } from "./library";
import { HttpError, primaryCategory, type Ctx } from "./refs";
import { downloadDrive, isDriveUrl } from "./drive";
import type { ImportItem, Kind } from "./types";

// ---------- processos externos ----------

export const BIN = {
  ytdlp: process.env.IRH_YTDLP || Bun.which("yt-dlp") || "/opt/homebrew/bin/yt-dlp",
  ffmpeg: Bun.which("ffmpeg") || "/opt/homebrew/bin/ffmpeg",
  ffprobe: Bun.which("ffprobe") || "/opt/homebrew/bin/ffprobe",
};

export async function run(cmd: string[], timeoutMs = 300_000) {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { code, stdout, stderr };
}

export async function sha256File(path: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
  }
  return h.digest("hex");
}

export async function probe(path: string) {
  const r = await run([BIN.ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height", "-of", "json", path], 60_000);
  if (r.code !== 0) return null;
  const j = JSON.parse(r.stdout);
  const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
  if (!v) return null;
  const duration = Number(j.format?.duration);
  return { width: v.width as number, height: v.height as number, duration: Number.isFinite(duration) && duration > 0 ? duration : null };
}

/** Nº de cortes por detecção de cena do ffmpeg (limiar 0.3). */
export async function detectCuts(path: string): Promise<number | null> {
  const r = await run([BIN.ffmpeg, "-hide_banner", "-nostats", "-i", path, "-vf", "scale=320:-2,select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], 180_000);
  if (r.code !== 0) return null;
  return (r.stderr.match(/pts_time:/g) ?? []).length;
}

async function makeFilmstrip(video: string, duration: number, out: string) {
  const fps = (8 / Math.max(duration, 1)).toFixed(4);
  const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-i", video, "-vf", `fps=${fps},scale=144:-2,tile=8x1`, "-frames:v", "1", "-q:v", "4", out], 120_000);
  return r.code === 0 && existsSync(out);
}

async function videoCodec(path: string): Promise<string | null> {
  const r = await run([BIN.ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path], 30_000);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/** Safari e o QuickTime não tocam VP9/AV1 dentro de MP4. A biblioteca guarda H.264. */
export async function ensurePlayable(path: string) {
  const codec = await videoCodec(path);
  if (!codec || codec === "h264") return;
  const out = `${path}.h264.mp4`;
  const r = await run([
    BIN.ffmpeg, "-y", "-v", "error", "-i", path,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    out,
  ], 300_000);
  if (r.code !== 0 || !existsSync(out)) {
    rmSync(out, { force: true });
    throw new ImportError(`O vídeo veio em ${codec} e a conversão para H.264 falhou.`);
  }
  rmSync(path, { force: true });
  renameSync(out, path);
}

async function frameAt(video: string, out: string, t = 1) {
  const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=720:-2", "-q:v", "3", out], 60_000);
  if (r.code !== 0 || !existsSync(out)) {
    await run([BIN.ffmpeg, "-y", "-v", "error", "-i", video, "-frames:v", "1", "-vf", "scale=720:-2", out], 60_000);
  }
  return existsSync(out);
}

// ---------- downloader ----------

export interface PostInfo {
  kind: Kind;
  username: string | null;
  display_name: string | null;
  caption: string;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Tipo bruto do Instagram (clips, feed, carousel_container…), só quando a fonte entrega. Nunca inferido. */
  product_type?: string | null;
}
/** Um slide do post. `file` NULL = slide conhecido e não baixado (sem login, o Instagram não o entregou). */
export interface DownloadedSlide { type: "video" | "imagem"; file: string | null; thumb: string | null }
export interface Downloaded {
  info: PostInfo;
  /** Vídeo principal (carrossel: o primeiro slide em vídeo). */
  video: string | null;
  /** Imagem de capa / foto. */
  image: string | null;
  /** Só em carrossel: todos os slides em ordem, inclusive os ausentes. */
  slides?: DownloadedSlide[];
}
export interface Downloader {
  /** true = rede real; a fila respeita o intervalo entre downloads. */
  throttled: boolean;
  download(url: string, dir: string, cookiesBrowser: string): Promise<Downloaded>;
  metrics(url: string, cookiesBrowser: string): Promise<PostInfo>;
}

export class ImportError extends Error {
  constructor(message: string, public retryable = false, public noVideo = false, public needsLogin = false) { super(message); }
}

/** Sessão do navegador para post que só abre logado. `IRH_YTDLP_COOKIES` escolhe o navegador; "off" desliga; padrão = Chrome (perfil Trabalho). */
export function sessaoDoNavegador(): string {
  const v = (process.env.IRH_YTDLP_COOKIES ?? "").trim();
  return /^(off|0|nao|não|no)$/i.test(v) ? "" : v || "chrome";
}

/** Mesmo logado, o Instagram às vezes devolve a resposta vazia e entrega o post na tentativa seguinte. */
export const LOGIN = { tentativas: 3, esperaMs: 3000 };

async function comSessao<T>(tentar: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try { return await tentar(); } catch (e) {
      if (!(e instanceof ImportError && e.needsLogin) || n >= LOGIN.tentativas) throw e;
      await Bun.sleep(LOGIN.esperaMs);
    }
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `total` = nº de slides do post quando é playlist; carrossel = mais de 1 item, mesmo sem nenhum vídeo. */
function toInfo(main: any, playlist: any | null, hasVideo: boolean, total = 0): PostInfo {
  const src = { ...playlist, ...main };
  const ts = num(src.timestamp);
  const kind: Kind = playlist && total > 1 ? "carrossel" : hasVideo ? "video" : "imagem";
  const pt = typeof src.product_type === "string" && src.product_type.trim() ? src.product_type.trim() : null;
  return {
    kind,
    username: src.channel ?? playlist?.channel ?? null,
    display_name: src.uploader ?? playlist?.uploader ?? null,
    caption: (main?.description || playlist?.description || "") as string,
    published_at: ts ? new Date(ts * 1000).toISOString() : null,
    views: num(src.view_count),
    likes: num(src.like_count),
    comments: num(src.comment_count),
    product_type: pt,
  };
}

// ---------- slides de carrossel (lidos da pasta que o yt-dlp preencheu) ----------

const VIDEO_EXT = [".mp4"];
// O original vem antes do jpg: a miniatura convertida de um slide em outro formato também se chama <id>.jpg.
const IMAGE_EXT = [".webp", ".png", ".jpeg", ".jpg"];

function readJson(path: string): any | null {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

export interface Collected {
  playlist: any | null;
  /** Metadados por slide, na ordem do post. */
  entries: any[];
  /** Nº real de slides do post (pode ser maior que o de arquivos). */
  total: number;
  slides: DownloadedSlide[];
  cover: string | null;
}

/**
 * Lê a pasta do yt-dlp e monta os slides em ordem. A ordem vem de `playlist_index`; sem ele,
 * da lista `entries` do playlist; sem ela, do nome do arquivo. Slide sem arquivo entra com `file: null`.
 */
export function collectSlides(dir: string, files: string[] = readdirSync(dir)): Collected {
  const jsons = files.filter((f) => f.endsWith(".info.json")).map((f) => readJson(join(dir, f))).filter(Boolean);
  const playlist = jsons.find((i) => i._type === "playlist") ?? null;
  const inline = ((playlist?.entries ?? []) as any[]).filter((e) => e && typeof e === "object" && e.id);
  const byId = new Map<string, any>();
  for (const e of inline) byId.set(String(e.id), e);
  for (const i of jsons) if (i._type !== "playlist" && i.id) byId.set(String(i.id), { ...byId.get(String(i.id)), ...i });
  const entries = [...byId.values()];
  const listed = new Map(((playlist?.entries ?? []) as any[]).map((e, i) => [String(e?.id ?? e), i]));
  const idx = (e: any) => (num(e.playlist_index) != null ? (e.playlist_index as number) : listed.has(String(e.id)) ? listed.get(String(e.id))! + 1 : Number.MAX_SAFE_INTEGER);
  entries.sort((a, b) => idx(a) - idx(b) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));

  const has = (name: string) => files.includes(name);
  const slides: DownloadedSlide[] = entries.map((e) => {
    const id = String(e.id);
    const vext = VIDEO_EXT.find((x) => has(id + x));
    if (vext) return { type: "video", file: join(dir, id + vext), thumb: has(`${id}.jpg`) ? join(dir, `${id}.jpg`) : null };
    const iext = IMAGE_EXT.find((x) => has(id + x));
    if (iext) return { type: "imagem", file: join(dir, id + iext), thumb: null };
    const looksVideo = (num(e.duration) ?? 0) > 0 || e.ext === "mp4" || e.vcodec;
    return { type: looksVideo ? "video" : "imagem", file: null, thumb: has(`${id}.jpg`) ? join(dir, `${id}.jpg`) : null };
  });
  const declared = Math.max(num(playlist?.playlist_count) ?? 0, num(playlist?.n_entries) ?? 0, ...entries.map((e) => num(e.n_entries) ?? 0));
  const total = Math.max(slides.length, declared);
  while (slides.length < total) slides.push({ type: "imagem", file: null, thumb: null });
  const cover = playlist?.id && has(`${playlist.id}.jpg`) ? join(dir, `${playlist.id}.jpg`) : null;
  return { playlist, entries, total, slides, cover };
}

/** Monta o resultado do download a partir da pasta. Playlist com mais de 1 item = carrossel. */
function readDownloaded(dir: string): Downloaded {
  const files = readdirSync(dir);
  const col = collectSlides(dir, files);
  if (col.playlist && col.total > 1) {
    const video = col.slides.find((s) => s.type === "video" && s.file)?.file ?? null;
    const image = col.slides.find((s) => s.type === "imagem" && s.file)?.file ?? col.cover;
    const info = toInfo(col.entries[0] ?? col.playlist, col.playlist, !!video, col.total);
    return { info, video, image, slides: col.slides };
  }
  const infos = files.filter((f) => f.endsWith(".info.json")).map((f) => readJson(join(dir, f))).filter(Boolean);
  const playlist = col.playlist;
  const video = files.find((f) => f.endsWith(".mp4")) ?? null;
  const vid = video?.replace(/\.mp4$/, "");
  const main = infos.find((i) => i._type !== "playlist" && (!vid || i.id === vid)) ?? playlist;
  if (!main) throw new ImportError("O yt-dlp não retornou metadados da publicação.");
  const jpgs = files.filter((f) => f.endsWith(".jpg"));
  const image = jpgs.find((f) => f.startsWith(`${main.id}.`)) ?? jpgs[0] ?? null;
  if (!video && !image) throw new ImportError("A publicação não tem vídeo nem imagem acessível.");
  return { info: toInfo(main, playlist, !!video), video: video && join(dir, video), image: image && join(dir, image) };
}

/** Traduz o stderr do yt-dlp num motivo legível. `sessao` = navegador cujos cookies a chamada já usou. */
export function classifyError(stderr: string, sessao = ""): ImportError {
  const last = stderr.split("\n").filter((l) => /ERROR/.test(l)).pop()?.replace(/^ERROR:\s*/, "").slice(0, 240) ?? stderr.trim().slice(-240);
  const s = stderr.toLowerCase();
  if (/no video (formats|in this post)|there is no video|no formats found/.test(s)) return new ImportError(`Publicação sem vídeo — ${last}`, false, true);
  if (/429|too many requests|please wait a few minutes/.test(s)) return new ImportError(`O Instagram limitou as requisições (taxa). — ${last}`, true);
  if (/private|this account is private/.test(s)) return new ImportError(`Publicação privada. — ${last}`);
  if (/rate-limit reached or login required|login required|cookies/.test(s)) {
    if (sessao) return new ImportError(`O Instagram exigiu login e nem a sessão do ${sessao} abriu o post: confira se o Instagram está logado nesse navegador. — ${last}`, false, false, true);
    return new ImportError(`O Instagram exigiu login: post privado, restrito por idade ou acesso limitado. — ${last}`, false, false, true);
  }
  if (/404|not found|does not exist|unavailable|been removed|no longer/.test(s)) return new ImportError(`Publicação indisponível ou removida. — ${last}`);
  if (/unable to download|timed out|connection|network|resolve host/.test(s)) return new ImportError(`Falha de rede ao acessar o Instagram. — ${last}`, true);
  return new ImportError(`Falha no download: ${last || "erro desconhecido do yt-dlp"}`);
}

export const ytdlp: Downloader = {
  throttled: true,
  async download(url, dir, cookiesBrowser) {
    const base = (cookies: string) => [BIN.ytdlp, "--no-progress", "-o", join(dir, "%(id)s.%(ext)s"), "--write-info-json", "--write-thumbnail", "--convert-thumbnails", "jpg",
      "--ffmpeg-location", BIN.ffmpeg, ...(cookies ? ["--cookies-from-browser", cookies] : [])];
    const pass = async (cookies: string) => {
      // H.264 primeiro. Se o Instagram só entregar VP9, ensurePlayable converte antes de gravar.
      let r = await run([...base(cookies), "-f", "bv*[vcodec^=avc1]+ba/b[ext=m4a]/bv*[vcodec^=avc1]+ba/bv*+ba/b", "--merge-output-format", "mp4", "--", url]);
      if (r.code !== 0) {
        const err = classifyError(r.stderr, cookies);
        if (!err.noVideo) throw err;
        // Foto ou slide sem vídeo: legenda, capa/imagens e métricas, sem baixar formatos. O que o 1º passo já gravou fica na pasta.
        r = await run([...base(cookies), "--ignore-no-formats-error", "--skip-download", "--", url]);
        if (r.code !== 0) throw classifyError(r.stderr, cookies);
      }
    };
    try {
      await pass(cookiesBrowser);
    } catch (e) {
      // Post que só abre logado (restrito por idade, região ou conta limitada): tenta de novo, sozinho, com a sessão do navegador.
      const sessao = sessaoDoNavegador();
      if (!(e instanceof ImportError && e.needsLogin) || cookiesBrowser || !sessao) throw e;
      await comSessao(async () => {
        for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true, force: true });
        await pass(sessao);
      });
      cookiesBrowser = sessao;
    }
    let got = readDownloaded(dir);
    // Slides ausentes: sem login o Instagram pode não entregar todas as imagens. Só tenta de novo com a sessão do
    // navegador se isso foi ligado de propósito (IRH_YTDLP_COOKIES=chrome); o padrão é nunca usar cookies aqui.
    const optIn = (process.env.IRH_YTDLP_COOKIES ?? "").trim() ? sessaoDoNavegador() : "";
    if (optIn && !cookiesBrowser && got.slides?.some((s) => !s.file)) {
      try { await pass(optIn); got = readDownloaded(dir); } catch { /* mantém o parcial; os ausentes ficam registrados */ }
    }
    return got;
  },
  async metrics(url, cookiesBrowser) {
    const ler = (cookies: string) => run([BIN.ytdlp, "-J", "--skip-download", "--ignore-no-formats-error", ...(cookies ? ["--cookies-from-browser", cookies] : []), "--", url], 120_000);
    let r = await ler(cookiesBrowser);
    if (r.code !== 0 && !cookiesBrowser && classifyError(r.stderr).needsLogin && sessaoDoNavegador()) {
      cookiesBrowser = sessaoDoNavegador();
      r = await comSessao(async () => {
        const x = await ler(cookiesBrowser);
        if (x.code !== 0) throw classifyError(x.stderr, cookiesBrowser);
        return x;
      });
    }
    if (r.code !== 0) throw classifyError(r.stderr, cookiesBrowser);
    const j = JSON.parse(r.stdout);
    const list = j._type === "playlist" ? ((j.entries ?? []) as any[]) : [];
    const first = j._type === "playlist" ? list[0] : j;
    const total = Math.max(list.length, num(j.playlist_count) ?? 0, num(j.n_entries) ?? 0);
    return toInfo(first, j._type === "playlist" ? j : null, true, total);
  },
};

// ---------- gravação de uma referência ----------

interface NewRef {
  source: "instagram" | "manual";
  url: string | null;
  shortcode: string | null;
  info: PostInfo;
  video: string | null;
  image: string | null;
  /** Só em carrossel (info.kind = 'carrossel'): todos os slides, em ordem, inclusive os não baixados. */
  slides?: DownloadedSlide[];
  metricsSource: string | null; // null = sem métrica
  categories?: number[];
  clients?: number[];
}

function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const slideName = (position: number) => String(position + 1).padStart(2, "0");

/** Miniatura de uma imagem (até 720 px de largura). */
async function imageThumb(src: string, out: string) {
  const r = await run([BIN.ffmpeg, "-y", "-v", "error", "-i", src, "-frames:v", "1", "-vf", "scale='min(720,iw)':-2", "-q:v", "3", out], 60_000);
  return r.code === 0 && existsSync(out);
}

interface PreparedSlide {
  position: number;
  type: "video" | "imagem";
  src: string | null;
  thumb: string | null;
  width: number | null; height: number | null; duration: number | null;
  hash: string | null; size: number | null;
}

/** Valida e prepara cada slide fora da transação. Slide ilegível vira "não baixado" (path NULL), nunca erro de importação. */
async function prepareSlides(slides: DownloadedSlide[], work: string): Promise<PreparedSlide[]> {
  const out: PreparedSlide[] = [];
  for (const [position, s] of slides.entries()) {
    const none: PreparedSlide = { position, type: s.type, src: null, thumb: null, width: null, height: null, duration: null, hash: null, size: null };
    if (!s.file || !existsSync(s.file)) { out.push(none); continue; }
    try {
      if (s.type === "video") await ensurePlayable(s.file);
    } catch { out.push(none); continue; }
    const meta = await probe(s.file);
    if (!meta) { out.push(none); continue; }
    const ext = extname(s.file).toLowerCase();
    const thumbOut = join(work, `${slideName(position)}.thumb.jpg`);
    let thumb: string | null = null;
    if (s.type === "video") {
      if (s.thumb && existsSync(s.thumb) && (await imageThumb(s.thumb, thumbOut))) thumb = thumbOut;
      else if (await frameAt(s.file, thumbOut)) thumb = thumbOut;
    } else if (await imageThumb(s.file, thumbOut)) {
      thumb = thumbOut;
    } else {
      thumb = join(work, `${slideName(position)}.thumb${ext}`);
      copyFileSync(s.file, thumb);
    }
    out.push({
      position, type: s.type, src: s.file, thumb,
      width: meta.width, height: meta.height, duration: s.type === "video" ? meta.duration : null,
      hash: await sha256File(s.file), size: statSync(s.file).size,
    });
  }
  return out;
}

/** Move os arquivos para a biblioteca e grava a referência numa transação. Devolve o ID. */
export async function saveRef(ctx: Ctx, n: NewRef): Promise<string> {
  const { db, root } = ctx;
  const carousel = n.info.kind === "carrossel" && !!n.slides?.length;
  mkdirSync(join(root, ".tmp"), { recursive: true });
  const work = mkdtempSync(join(root, ".tmp", "sv-"));
  let slides: PreparedSlide[] = [];
  let hashSource: string | null;
  let primaryVideo: string | null;
  let primaryMeta: Awaited<ReturnType<typeof probe>> = null;
  let imgMeta: Awaited<ReturnType<typeof probe>> = null;
  let thumb: string | null = null;
  let cuts: number | null = null;
  let strip: string | null = null;
  try {
    if (carousel) {
      slides = await prepareSlides(n.slides!, work);
      const pv = slides.find((s) => s.type === "video" && s.src);
      primaryVideo = pv?.src ?? null;
      primaryMeta = pv ? { width: pv.width!, height: pv.height!, duration: pv.duration } : null;
      const firstOk = pv ?? slides.find((s) => s.src);
      hashSource = firstOk?.src ?? null;
      // Capa = miniatura do slide 1; se ele não veio, a capa do próprio post (quando o Instagram a entrega).
      thumb = slides[0]?.thumb ?? null;
      if (!thumb && n.image && existsSync(n.image)) {
        thumb = join(work, "capa.jpg");
        if (!(await imageThumb(n.image, thumb))) { copyFileSync(n.image, thumb); }
      }
      if (!pv) imgMeta = slides.find((s) => s.src) ? { width: slides.find((s) => s.src)!.width!, height: slides.find((s) => s.src)!.height!, duration: null } : null;
    } else {
      if (n.video) await ensurePlayable(n.video);
      primaryVideo = n.video;
      primaryMeta = n.video ? await probe(n.video) : null;
      if (n.video && !primaryMeta) throw new ImportError("O arquivo baixado não é um vídeo válido (ffprobe).");
      hashSource = n.video ?? n.image!;
      thumb = n.image;
      if (n.video && !thumb) thumb = (await frameAt(n.video, join(work, "thumb.jpg"))) ? join(work, "thumb.jpg") : null;
      imgMeta = !n.video && n.image ? await probe(n.image) : null;
    }
    const hash = hashSource ? await sha256File(hashSource) : null;
    const size = hashSource ? statSync(hashSource).size : null;
    cuts = primaryVideo ? await detectCuts(primaryVideo) : null;
    strip = primaryVideo && primaryMeta?.duration && (await makeFilmstrip(primaryVideo, primaryMeta.duration, join(work, "strip.jpg"))) ? join(work, "strip.jpg") : null;

    const month = monthKey();
    const moved: string[] = [];
    let slidesDir: string | null = null;
    const move = (from: string, rel: string) => {
      const to = join(root, rel);
      mkdirSync(join(to, ".."), { recursive: true });
      try { renameSync(from, to); } catch { copyFileSync(from, to); rmSync(from, { force: true }); }
      moved.push(to);
      return rel;
    };
    try {
      const ts = now();
      const id = db.transaction(() => {
        // Contador em settings: excluir a maior REF não devolve o número dela.
        const contador = Number((db.query("SELECT value FROM settings WHERE key = 'ref_seq_ultimo'").get() as any)?.value ?? 0);
        const seq = Math.max(contador, (db.query("SELECT max(seq) s FROM refs").get() as any).s ?? 0) + 1;
        db.run("INSERT INTO settings (key, value) VALUES ('ref_seq_ultimo', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [String(seq)]);
        const id = refId(month, seq);
        const [y, m] = month.split("-");
        const mediaCount = carousel ? slides.length : 1;
        db.run(`INSERT INTO refs (id, seq_month, seq, shortcode, url, kind, source, username, display_name, caption, hashtags, cta_keyword,
            published_at, imported_at, duration, width, height, file_hash, file_size, cuts, avg_shot, updated_at, origem, media_count, product_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
          id, month, seq, n.shortcode, n.url, n.info.kind, n.source, n.info.username, n.info.display_name,
          n.info.caption, extractHashtags(n.info.caption), extractCta(n.info.caption),
          n.info.published_at, ts, primaryMeta?.duration ?? null, primaryMeta?.width ?? imgMeta?.width ?? null, primaryMeta?.height ?? imgMeta?.height ?? null,
          hash, size, cuts, cuts != null && primaryMeta?.duration ? primaryMeta.duration / (cuts + 1) : null, ts,
          n.source === "instagram" ? "instagram" : "upload", mediaCount, n.info.product_type ?? null,
        ]);
        for (const c of n.categories ?? []) db.run("INSERT OR IGNORE INTO ref_categories (ref_id, category_id) VALUES (?, ?)", [id, c]);
        for (const c of n.clients ?? []) db.run("INSERT OR IGNORE INTO ref_clients (ref_id, client_id) VALUES (?, ?)", [id, c]);
        if (n.metricsSource) {
          db.run("INSERT INTO metric_snapshots (ref_id, views, likes, comments, collected_at, source) VALUES (?, ?, ?, ?, ?, ?)",
            [id, n.info.views, n.info.likes, n.info.comments, ts, n.metricsSource]);
        }
        const addMedia = db.prepare(`INSERT INTO ref_media (ref_id, position, type, path, thumb_path, width, height, duration, file_hash, file_size)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        let videoRel: string | null = null;
        let thumbRel: string | null = null;
        if (carousel) {
          slidesDir = join(root, "slides", id);
          const rels = slides.map((s) => {
            const nn = slideName(s.position);
            const path = s.src ? move(s.src, join("slides", id, `${nn}${extname(s.src).toLowerCase() || (s.type === "video" ? ".mp4" : ".jpg")}`)) : null;
            // O thumb do slide 1 é a capa do post (thumbnails/<REF>.jpg), compartilhada com refs.thumb_path.
            const tRel = s.position === 0 && thumb && s.thumb === thumb
              ? move(s.thumb, join("thumbnails", `${id}.jpg`))
              : s.thumb ? move(s.thumb, join("slides", id, `${nn}.thumb${extname(s.thumb).toLowerCase() || ".jpg"}`)) : null;
            return { path, thumb: tRel };
          });
          thumbRel = rels[0]?.thumb ?? null;
          if (!thumbRel && thumb) thumbRel = move(thumb, join("thumbnails", `${id}.jpg`));
          // video_path continua existindo (análise e replicação leem dele): vínculo físico com o 1º slide em vídeo.
          const pvIdx = slides.findIndex((s) => s.type === "video" && s.src);
          if (pvIdx >= 0 && rels[pvIdx].path) {
            videoRel = join("videos", y, m, videoFileName(id, n.info.username, primaryCategory(db, id)));
            const to = join(root, videoRel), from = join(root, rels[pvIdx].path!);
            mkdirSync(join(to, ".."), { recursive: true });
            try { linkSync(from, to); } catch { copyFileSync(from, to); }
            moved.push(to);
          }
          slides.forEach((s, i) => addMedia.run(id, s.position, s.type, rels[i].path, rels[i].thumb, s.width, s.height, s.duration, s.hash, s.size));
        } else {
          videoRel = n.video ? move(n.video, join("videos", y, m, videoFileName(id, n.info.username, primaryCategory(db, id)))) : null;
          thumbRel = thumb ? move(thumb, join("thumbnails", `${id}${extname(thumb) || ".jpg"}`)) : null;
          addMedia.run(id, 0, n.video ? "video" : "imagem", videoRel ?? thumbRel, thumbRel,
            primaryMeta?.width ?? imgMeta?.width ?? null, primaryMeta?.height ?? imgMeta?.height ?? null, primaryMeta?.duration ?? null, hash, size);
        }
        const stripRel = strip ? move(strip, join("thumbnails", `${id}_tira.jpg`)) : null;
        db.run("UPDATE refs SET video_path = ?, thumb_path = ?, filmstrip_path = ? WHERE id = ?", [videoRel, thumbRel, stripRel, id]);
        return id;
      })();
      if (n.info.username) void ensureAvatar(root, n.info.username);
      return id;
    } catch (e) {
      for (const f of moved) rmSync(f, { force: true });
      if (slidesDir) rmSync(slidesDir, { recursive: true, force: true });
      throw e;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- foto de perfil do criador ----------

const avatarEmCurso = new Set<string>();

/** Baixa a foto pública (og:image) do @ para avatars/<username>.jpg, uma vez por criador. Falha em silêncio: a UI cai na inicial. */
export async function ensureAvatar(root: string, username: string) {
  if (process.env.IRH_DOWNLOADER === "fake" || !/^[A-Za-z0-9._]{1,30}$/.test(username) || avatarEmCurso.has(username)) return;
  const dest = join(root, "avatars", `${username}.jpg`);
  if (existsSync(dest)) return;
  avatarEmCurso.add(username);
  try {
    const headers = { "User-Agent": "facebookexternalhit/1.1" };
    const page = await (await fetch(`https://www.instagram.com/${username}/`, { headers, signal: AbortSignal.timeout(15_000) })).text();
    const url = page.match(/og:image" content="([^"]+)/)?.[1]?.replaceAll("&amp;", "&");
    if (!url) return;
    const img = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!img.ok) return;
    mkdirSync(join(root, "avatars"), { recursive: true });
    await Bun.write(dest, await img.arrayBuffer());
  } catch {
    // perfil privado, removido ou bloqueio temporário
  } finally {
    avatarEmCurso.delete(username);
  }
}

// ---------- fila de importação ----------

/** Atribuições de um lote. `notes` mapeia URL → nota da referência. */
export interface Assign { clients?: number[]; categories?: number[]; collection?: number; notes?: Record<string, string> }

type Listener = (ev: { type: "item"; item: ImportItem } | { type: "job"; job_id: number }) => void;

export class Importer {
  private queue: number[] = [];
  private running = false;
  private listeners = new Set<Listener>();
  rateLimitWaitMs = Number(process.env.IRH_RATE_WAIT_MS ?? 60_000);

  constructor(private ctx: Ctx, private dl: Downloader) {}

  on(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(id: number) {
    const item = this.ctx.db.query("SELECT * FROM import_items WHERE id = ?").get(id) as ImportItem;
    for (const l of this.listeners) l({ type: "item", item });
  }

  private setItem(id: number, status: ImportItem["status"], error: string | null = null, ref: string | null = null) {
    this.ctx.db.run("UPDATE import_items SET status = ?, error = ?, ref_id = ?, updated_at = ? WHERE id = ?", [status, error, ref, now(), id]);
    this.emit(id);
  }

  /** Cria um lote a partir de URLs. Inválidos e duplicados são resolvidos na hora; o resto entra na fila. */
  enqueue(urls: string[], source: string, assign?: Assign) {
    const { db } = this.ctx;
    const list = urls.map((u) => u.trim()).filter(Boolean);
    if (!list.length) throw new HttpError(400, "Nenhum link encontrado");
    if (list.length > 1000) throw new HttpError(400, "Máximo de 1000 links por lote");
    const ts = now();
    const jobId = Number(db.run("INSERT INTO import_jobs (source, created_at, assign) VALUES (?, ?, ?)",
      [source, ts, assign ? JSON.stringify(assign) : null]).lastInsertRowid);
    const seen = new Set<string>();
    const toQueue: number[] = [];
    db.transaction(() => {
      for (const url of list) {
        const code = parseShortcode(url);
        let status: ImportItem["status"] = "pendente", error: string | null = null, ref: string | null = null;
        if (!code) {
          status = "erro";
          error = "Link inválido: não é uma publicação do Instagram (/p/, /reel/ ou /tv/).";
        } else if (seen.has(code)) {
          status = "duplicado";
          error = "Repetido neste lote.";
        } else {
          const existing = db.query("SELECT id FROM refs WHERE shortcode = ?").get(code) as any;
          if (existing) { status = "duplicado"; error = "Já está na biblioteca."; ref = existing.id; }
        }
        if (code) seen.add(code);
        const id = Number(db.run("INSERT INTO import_items (job_id, url, shortcode, status, error, ref_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [jobId, url, code, status, error, ref, ts]).lastInsertRowid);
        if (status === "pendente") toQueue.push(id);
      }
    })();
    this.queue.push(...toQueue);
    for (const l of this.listeners) l({ type: "job", job_id: jobId });
    this.kick();
    return this.job(jobId);
  }

  job(id: number) {
    const j = this.ctx.db.query("SELECT * FROM import_jobs WHERE id = ?").get(id) as any;
    if (!j) throw new HttpError(404, "Lote não encontrado");
    j.assign = j.assign ? JSON.parse(j.assign) : null;
    j.items = this.ctx.db.query("SELECT * FROM import_items WHERE job_id = ? ORDER BY id").all(id);
    return j;
  }

  jobs(limit = 30) {
    return (this.ctx.db.query("SELECT id FROM import_jobs ORDER BY id DESC LIMIT ?").all(limit) as any[]).map((j) => this.job(j.id));
  }

  /** No boot: itens interrompidos voltam para a fila. */
  resume() {
    const { db } = this.ctx;
    db.run("UPDATE import_items SET status = 'pendente' WHERE status = 'baixando'");
    this.queue.push(...(db.query("SELECT id FROM import_items WHERE status = 'pendente' ORDER BY id").all() as any[]).map((r) => r.id));
    this.kick();
  }

  get busy() {
    return this.running || this.queue.length > 0;
  }

  private kick() {
    if (this.running) return;
    this.running = true;
    this.loop().finally(() => (this.running = false));
  }

  private async loop() {
    let first = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      if (this.dl.throttled && !first) await Bun.sleep(Number(getSettings(this.ctx).import_delay_ms));
      first = false;
      try {
        await this.process(id);
      } catch (e: any) {
        // Nada escapa: o erro fica registrado no item e o lote segue.
        this.setItem(id, "erro", `Erro interno: ${e?.message ?? e}`);
      }
    }
  }

  private async process(id: number) {
    const { db, root } = this.ctx;
    const item = db.query("SELECT * FROM import_items WHERE id = ?").get(id) as ImportItem;
    if (!item || item.status !== "pendente") return;
    const existing = db.query("SELECT id FROM refs WHERE shortcode = ?").get(item.shortcode) as any;
    if (existing) return this.setItem(id, "duplicado", "Já está na biblioteca.", existing.id);
    this.setItem(id, "baixando");
    mkdirSync(join(root, ".tmp"), { recursive: true });
    const dir = mkdtempSync(join(root, ".tmp", "imp-"));
    try {
      const url = canonicalUrl(item.shortcode!);
      const cookies = getSettings(this.ctx).cookies_browser;
      let got: Downloaded;
      try {
        got = await this.dl.download(url, dir, cookies);
      } catch (e) {
        if (!(e instanceof ImportError && e.retryable)) throw e;
        await Bun.sleep(this.rateLimitWaitMs);
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        got = await this.dl.download(url, dir, cookies);
      }
      const job = db.query("SELECT assign FROM import_jobs WHERE id = ?").get(item.job_id) as any;
      const a: Assign = job?.assign ? JSON.parse(job.assign) : {};
      const ref = await saveRef(this.ctx, {
        source: "instagram", url, shortcode: item.shortcode, ...got, metricsSource: "yt-dlp", categories: a.categories, clients: a.clients,
      });
      if (a.collection) db.run("INSERT OR IGNORE INTO collection_refs (collection_id, ref_id, position) VALUES (?, ?, ?)", [a.collection, ref, item.id]);
      const note = a.notes?.[item.url];
      if (note) db.run("UPDATE refs SET notes = ? WHERE id = ?", [note, ref]);
      this.setItem(id, "ok", null, ref);
    } catch (e: any) {
      if (String(e?.message).includes("UNIQUE constraint failed: refs.shortcode")) {
        const ex = db.query("SELECT id FROM refs WHERE shortcode = ?").get(item.shortcode) as any;
        return this.setItem(id, "duplicado", "Já está na biblioteca.", ex?.id ?? null);
      }
      this.setItem(id, "erro", e instanceof ImportError ? e.message : `Erro interno: ${e?.message ?? e}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Nova leitura de métricas → novo snapshot (nunca sobrescreve o anterior). */
  async refreshMetrics(refIdValue: string) {
    const { db } = this.ctx;
    const r = db.query("SELECT url, shortcode FROM refs WHERE id = ?").get(refIdValue) as any;
    if (!r) throw new HttpError(404, "Referência não encontrada");
    if (!r.shortcode) throw new HttpError(400, "Referência sem link do Instagram — métricas só podem ser informadas manualmente.");
    try {
      const info = await this.dl.metrics(canonicalUrl(r.shortcode), getSettings(this.ctx).cookies_browser);
      db.run("INSERT INTO metric_snapshots (ref_id, views, likes, comments, collected_at, source) VALUES (?, ?, ?, ?, ?, ?)",
        [refIdValue, info.views, info.likes, info.comments, now(), "yt-dlp"]);
    } catch (e: any) {
      throw new HttpError(502, e instanceof ImportError ? e.message : `Falha ao atualizar métricas: ${e?.message}`);
    }
  }

  /** Upload manual de um vídeo obtido legitimamente. */
  async importManual(file: File, f: Record<string, string>) {
    const { db, root } = this.ctx;
    if (!file || !file.size) throw new HttpError(400, "Envie um arquivo de vídeo");
    if (file.size > 4 * 1024 ** 3) throw new HttpError(413, "Arquivo maior que 4 GB");
    const url = f.url?.trim() || null;
    const code = url ? parseShortcode(url) : null;
    if (url && !code && !isDriveUrl(url)) throw new HttpError(400, "Link original inválido");
    if (code) {
      const ex = db.query("SELECT id FROM refs WHERE shortcode = ?").get(code) as any;
      if (ex) throw new HttpError(409, `Link duplicado: já está na biblioteca como ${ex.id}`, { existing: ex.id });
    }
    mkdirSync(join(root, ".tmp"), { recursive: true });
    const dir = mkdtempSync(join(root, ".tmp", "up-"));
    try {
      const ext = (extname(file.name || "") || ".mp4").toLowerCase().replace(/[^.a-z0-9]/g, "");
      const raw = join(dir, `entrada${ext}`);
      await Bun.write(raw, file);
      if (!(await probe(raw))) throw new HttpError(400, "O arquivo não contém vídeo legível");
      const hash = await sha256File(raw);
      const dup = db.query("SELECT id FROM refs WHERE file_hash = ?").get(hash) as any;
      if (dup) throw new HttpError(409, `Arquivo duplicado: mesmo conteúdo de ${dup.id}`, { existing: dup.id });
      let video = raw;
      if (ext !== ".mp4") {
        video = join(dir, "video.mp4");
        let r = await run([BIN.ffmpeg, "-y", "-v", "error", "-i", raw, "-c", "copy", "-movflags", "+faststart", video]);
        if (r.code !== 0) r = await run([BIN.ffmpeg, "-y", "-v", "error", "-i", raw, "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart", video], 1_800_000);
        if (r.code !== 0) throw new HttpError(400, "Não foi possível converter o arquivo para MP4");
      }
      const metric = (k: string) => (f[k]?.trim() ? Math.max(0, Math.round(Number(f[k]))) : null);
      const info: PostInfo = {
        kind: "video",
        username: f.username?.trim().replace(/^@/, "") || null,
        display_name: f.display_name?.trim() || null,
        caption: f.caption ?? "",
        published_at: f.published_at && !Number.isNaN(Date.parse(f.published_at)) ? new Date(f.published_at).toISOString() : null,
        views: metric("views"), likes: metric("likes"), comments: metric("comments"),
      };
      if ([info.views, info.likes, info.comments].some((v) => v != null && !Number.isFinite(v))) throw new HttpError(400, "Métricas devem ser números");
      const hasMetric = [info.views, info.likes, info.comments].some((v) => v != null);
      const list = (k: string) => (f[k] ? f[k].split(",").map(Number).filter(Number.isFinite) : []);
      const id = await saveRef(this.ctx, {
        source: "manual", url: code ? canonicalUrl(code) : url, shortcode: code, info, video, image: null,
        metricsSource: hasMetric ? "manual" : null, categories: list("categories"), clients: list("clients"),
      });
      const jobId = Number(db.run("INSERT INTO import_jobs (source, created_at) VALUES ('manual', ?)", [now()]).lastInsertRowid);
      db.run("INSERT INTO import_items (job_id, url, shortcode, status, ref_id, updated_at) VALUES (?, ?, ?, 'ok', ?, ?)",
        [jobId, url ?? file.name ?? "upload", code, id, now()]);
      return id;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Link do Google Drive: baixa com a sessão do Chrome de geração e segue como upload manual (origem = o link). */
  async importDrive(f: Record<string, string>) {
    const url = f.url?.trim() ?? "";
    if (!isDriveUrl(url)) throw new HttpError(400, "Link do Drive inválido");
    const ex = this.ctx.db.query("SELECT id FROM refs WHERE url = ?").get(url) as any;
    if (ex) throw new HttpError(409, `Link duplicado: já está na biblioteca como ${ex.id}`, { existing: ex.id });
    const got = await downloadDrive(this.ctx.root, url);
    try {
      return await this.importManual(Bun.file(got.file) as unknown as File, { ...f, url });
    } finally {
      rmSync(got.dir, { recursive: true, force: true });
    }
  }
}
