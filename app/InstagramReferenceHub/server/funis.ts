import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import {
  SUBTIPOS_PAGINA, SWIPES, TIPOS_ETAPA, TIPOS_SWIPE,
  type Conexao, type Etapa, type Funil, type Origem, type Swipe, type TipoSwipe,
} from "./funis-tipos";
import { now } from "./db";
import { listarCarrosseis, type Carrossel } from "./perfis-vault";
import { listPipeline } from "./pipeline";
import { HttpError, type Ctx } from "./refs";
import { expertSlug } from "./text";

/**
 * Funis e swipe de funil (páginas, quiz, DMs, bios).
 *
 * Organização em disco, um arquivo por item, legível por gente e por agente:
 *
 *   library/funis/
 *     LEIA-ME.md                      ← esta estrutura, escrita pelo próprio Hub
 *     funis/<id>.json                 ← um funil (etapas + conexões + vínculos)
 *     swipes/paginas|quiz|dms|bios/<id>.json  (+ <id>.png|jpg|webp = print)
 *
 * Vínculos apontam, sem copiar, para o que já existe:
 *   ref   → REF da biblioteca (post/reel de referência ou do expert)
 *   swipe → item do swipe acima
 *   vault → página capturada no vault (só leitura): 05_Biblioteca/04_Paginas/01_paginas e
 *           05_Biblioteca/_swipe/07 Funis e Paginas Capturadas
 */

const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const MAX_IMG = 15 * 1024 ** 2;

export const funisRoot = (root: string) => join(root, "funis");
const funisDir = (root: string) => join(funisRoot(root), "funis");
const pastaSwipe = (root: string, tipo: TipoSwipe) => join(funisRoot(root), "swipes", SWIPES.find((s) => s.tipo === tipo)!.pasta);

const LEIA_ME = `# Funis — organização dos arquivos

Pasta mantida pelo Reference Hub (aba Funis). Um arquivo por item; editar pela interface.

| Pasta | O que guarda |
|---|---|
| \`funis/<id>.json\` | um funil: etapas (post, comentário, DM, bio, link, página, quiz, checkout…), conexões com rótulo e % de distribuição, e os vínculos de cada etapa |
| \`swipes/paginas/\` | páginas de venda, captura, advertorial, checkout, upsell |
| \`swipes/quiz/\` | quizzes (perguntas, resultado, oferta) |
| \`swipes/dms/\` | DMs e roteiros de automação (gatilho → mensagens) |
| \`swipes/bios/\` | bios de Instagram |

Cada swipe pode ter um print com o mesmo id (\`<id>.png\`).

## Vínculos (nada é copiado)

- \`ref\` = REF da biblioteca de vídeos (\`REF-AAAA-MM-NNNN\`).
- \`swipe\` = id de um item de \`swipes/\`.
- \`vault\` = caminho relativo ao vault \`a pasta OrganicSet\` de uma página já capturada
  (\`05_Biblioteca/04_Paginas/01_paginas/…\` ou \`05_Biblioteca/_swipe/07 Funis e Paginas Capturadas/…\`). O Hub só lê.
- \`expert\` = slug do perfil (o mesmo de \`/api/profiles\` e do painel privado).
- \`origem\`: \`referencia\` (funil/peça de outra pessoa, para estudo) ou \`proprio\` (do expert).

Funil é demonstrativo: não conecta com Instagram, WhatsApp ou página.
API: \`GET /api/funis?profile=<slug>&completo=1\` (é o que o painel privado lê).
`;

export function ensureFunis(root: string) {
  mkdirSync(funisDir(root), { recursive: true });
  for (const s of SWIPES) mkdirSync(pastaSwipe(root, s.tipo), { recursive: true });
  const leia = join(funisRoot(root), "LEIA-ME.md");
  if (!existsSync(leia) || readFileSync(leia, "utf8") !== LEIA_ME) writeFileSync(leia, LEIA_ME, "utf8");
}

// ---------- utilidades ----------

const sufixo = () => Math.random().toString(36).slice(2, 6);
const novoId = (nome: string) => `${(expertSlug(nome) || "item").slice(0, 48)}-${sufixo()}`;
const idValido = (id: string) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);

function lerJson<T>(abs: string): T | null {
  try { return JSON.parse(readFileSync(abs, "utf8")) as T; } catch { return null; }
}

/** Grava por arquivo temporário + rename: um JSON nunca fica pela metade. */
function gravarJson(abs: string, data: unknown) {
  const tmp = `${abs}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, abs);
}

const str = (v: unknown, max = 5000) => (v == null ? "" : String(v)).slice(0, max);
const strOuNull = (v: unknown, max = 2000) => {
  const s = str(v, max).trim();
  return s ? s : null;
};
const num = (v: unknown, def = 0) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : def);
const origem = (v: unknown): Origem => (v === "proprio" ? "proprio" : "referencia");

function urlOk(v: unknown): string | null {
  const s = strOuNull(v, 2000);
  if (!s) return null;
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** Caminho relativo do vault já normalizado e sem escapar das raízes permitidas. */
function vaultRel(v: unknown): string | null {
  const s = strOuNull(v, 1000);
  if (!s) return null;
  const rel = s.replace(/^\/+/, "");
  if (rel.split("/").includes("..")) throw new HttpError(400, "Caminho do vault inválido");
  if (!VAULT_RAIZES.some((r) => rel === r || rel.startsWith(r + "/"))) throw new HttpError(400, "Página fora das pastas de páginas do vault");
  return rel;
}

// ---------- vault (só leitura) ----------

const VAULT_REF = "05_Biblioteca/04_Paginas/01_paginas";
const VAULT_SWIPE = "05_Biblioteca/_swipe/07 Funis e Paginas Capturadas";
const VAULT_TRAB = "05_Biblioteca/04_Paginas/02_trabalhos";
const VAULT_RAIZES = [VAULT_REF, VAULT_SWIPE, VAULT_TRAB];

export const vaultRoot = () => process.env.IRH_VAULT ?? join(import.meta.dir, "../../..");

export type ArquivoPagina = { rel: string; nome: string; tipo: "html" | "mhtml" | "pdf" };

export interface PaginaVault {
  rel: string;
  nome: string;
  grupo: string;
  fonte: "referencias" | "swipe" | "trabalho";
  tipo: "pagina" | "quiz" | "checkout" | "upsell" | "advertorial" | "outro";
  capa: string | null;
  /** Arquivo principal para ver a página (html > mhtml > pdf). Null = só capturas em imagem. */
  entrada: string | null;
  /** Mantido por compatibilidade: igual a `entrada` ou, sem ela, a pasta. */
  abrir: string;
  arquivos: ArquivoPagina[];
  imagens: string[];
}

function tipoPorNome(nome: string): PaginaVault["tipo"] {
  const n = nome.toLowerCase();
  if (n.includes("quiz")) return "quiz";
  if (n.includes("checkout")) return "checkout";
  if (n.includes("downsell") || n.includes("upsell")) return "upsell";
  if (n.includes("advertorial")) return "advertorial";
  if (n.includes("pagina") || n.includes("página") || n.includes("pv")) return "pagina";
  return "outro";
}

const TIPO_ARQ: Record<string, ArquivoPagina["tipo"]> = { ".html": "html", ".htm": "html", ".mhtml": "mhtml", ".mht": "mhtml", ".pdf": "pdf" };
/** Arquivos auxiliares que o navegador salva junto da página (iframes de player, rastreio, ipify…). */
const AUXILIAR = /^(saved_resource|savevid|controller-|m-outer-|inner\.html$|i\.html$|x\.html$|embed\.html$|iframe|sw\.html$|blank)/i;
const DOMINIO_AUX = /(ipify|b-cdn\.net|googletagmanager|facebook|doubleclick|vturb|youtube|vimeo|(^|\/)[\w.-]*cdn[\w.-]*\/|(^|\/)(audios|images|img|signals|static|assets)\/)/i;
/** Pastas que não são a página: versões antigas e exportações do editor de referências. */
const PASTA_IGNORADA = /^(historico|exportacoes|versoes|backup|node_modules)$|_files$/i;
const natural = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" }).compare;

/** Varre uma captura (até 3 níveis, sem as pastas *_files do navegador). */
function varrer(dir: string, prof = 4, out: { abs: string; size: number }[] = []) {
  let ents: string[];
  try { ents = readdirSync(dir); } catch { return out; }
  for (const f of ents) {
    if (f.startsWith(".")) continue;
    const abs = join(dir, f);
    let st;
    try { st = statSync(abs); } catch { continue; }
    if (st.isDirectory()) { if (prof > 0 && !PASTA_IGNORADA.test(f)) varrer(abs, prof - 1, out); }
    else out.push({ abs, size: st.size });
  }
  return out;
}

/** Escolhe a página principal: html "de verdade" (o maior, fora dos auxiliares) > primeiro mhtml > primeiro pdf. */
function analisarPasta(dirAbs: string, rel: (a: string) => string) {
  const todos = varrer(dirAbs);
  const arquivos = todos
    .filter((f) => TIPO_ARQ[extname(f.abs).toLowerCase()])
    .map((f) => ({ ...f, tipo: TIPO_ARQ[extname(f.abs).toLowerCase()], r: relative(dirAbs, f.abs) }))
    .sort((a, b) => natural(a.r, b.r));
  const htmlBom = arquivos.filter((f) => f.tipo === "html" && !AUXILIAR.test(basename(f.abs)) && !DOMINIO_AUX.test(f.r) && f.size > 2048);
  // index.html de um domínio salvo é a página; senão, o maior HTML que não é auxiliar.
  const doAbrir = abrirDe(dirAbs);
  const entrada = (doAbrir ? arquivos.find((f) => f.abs === doAbrir) : undefined)
    ?? htmlBom.sort((a, b) => Number(/(^|\/)index\.html?$/i.test(b.r)) - Number(/(^|\/)index\.html?$/i.test(a.r)) || b.size - a.size)[0]
    ?? arquivos.find((f) => f.tipo === "mhtml") ?? arquivos.find((f) => f.tipo === "pdf")
    ?? arquivos.find((f) => f.tipo === "html" && f.size > 2048) ?? null;
  const visiveis = arquivos.filter((f) => f.tipo !== "html" || f === entrada || (!AUXILIAR.test(basename(f.abs)) && !DOMINIO_AUX.test(f.r)));
  const imagens = todos.filter((f) => IMG_EXT.has(extname(f.abs).toLowerCase()) && f.size > 8 * 1024)
    .map((f) => f.abs).sort(natural).slice(0, 80).map(rel);
  return {
    entrada: entrada ? rel(entrada.abs) : null,
    arquivos: visiveis.slice(0, 300).map((f) => ({ rel: rel(f.abs), nome: f.r.split(sep).join("/"), tipo: f.tipo })),
    imagens,
  };
}

/** Destino do ABRIR.html (meta refresh) quando a pasta segue o padrão "abrir com dois cliques". */
function abrirDe(dir: string): string | null {
  const a = join(dir, "ABRIR.html");
  if (!existsSync(a)) return null;
  const alvo = readFileSync(a, "utf8").match(/url=([^"'>]+)/i)?.[1]?.trim();
  if (!alvo) return null;
  const abs = resolve(dir, decodeURIComponent(alvo));
  return abs.startsWith(dir + sep) && existsSync(abs) ? abs : null;
}

/**
 * Capa de uma captura: print de capturas/ (ou prints/, screenshots/) quando existe. Sem print e com página salva,
 * nenhuma capa: a interface mostra a própria página reduzida (imagem solta da pasta costuma ser um recurso da página,
 * não a página). Sem página, a primeira imagem serve.
 */
function capaDaPasta(dir: string, a: { entrada: string | null; imagens: string[] }, rel: (x: string) => string): string | null {
  for (const sub of ["capturas", "prints", "screenshots"]) {
    const img = primeiraImagem(join(dir, sub), 0);
    if (img) return rel(img);
  }
  if (a.entrada) return null;
  const img = primeiraImagem(dir, 0);
  return img ? rel(img) : a.imagens[0] ?? null;
}

function primeiraImagem(dir: string, profundidade = 2): string | null {
  let ents: string[];
  try { ents = readdirSync(dir).sort(); } catch { return null; }
  const img = ents.find((f) => IMG_EXT.has(extname(f).toLowerCase()) && !f.startsWith("."));
  if (img) return join(dir, img);
  if (profundidade <= 0) return null;
  for (const sub of ents.filter((f) => ["capturas", "prints", "screenshots"].includes(f.toLowerCase()))) {
    const r = primeiraImagem(join(dir, sub), profundidade - 1);
    if (r) return r;
  }
  return null;
}

const dirs = (abs: string) => {
  try { return readdirSync(abs).filter((f) => !f.startsWith(".") && !f.startsWith("_") && statSync(join(abs, f)).isDirectory()).sort(); } catch { return []; }
};

export function paginasVault(): PaginaVault[] {
  const v = vaultRoot();
  const out: PaginaVault[] = [];
  const rel = (abs: string) => relative(v, abs).split(sep).join("/");

  // 1) _referencias: catalogo.json manda (nome, página e capa por item). A página é servida pelo Hub por http,
  //    então o HTML real (site/...) funciona mesmo quando o file:// quebraria (módulos, fontes).
  const cat = lerJson<{ name: string; group?: string; package: string; page: string; cover?: string }[]>(join(v, "05_Biblioteca/04_Paginas", "catalogo.json")) ?? [];
  for (const c of cat) {
    const pac = join(v, VAULT_REF, c.package);
    const page = join(pac, c.page);
    if (!existsSync(page)) continue;
    const caps = join(pac, "capturas");
    const imagens = existsSync(caps) ? readdirSync(caps).filter((f) => IMG_EXT.has(extname(f).toLowerCase())).sort(natural).map((f) => rel(join(caps, f))) : [];
    out.push({
      rel: rel(page), nome: c.name, grupo: c.group ?? c.package, fonte: "referencias", tipo: tipoPorNome(c.name) === "outro" ? "pagina" : tipoPorNome(c.name),
      capa: c.cover && existsSync(join(pac, c.cover)) ? rel(join(pac, c.cover)) : null,
      entrada: rel(page), abrir: rel(page), arquivos: [{ rel: rel(page), nome: c.page, tipo: "html" }], imagens,
    });
  }
  // 2) Swipe 07: uma pasta = uma captura (página, quiz etapa por etapa, checkout…), às vezes com vários arquivos.
  for (const d of dirs(join(v, VAULT_SWIPE))) {
    const abs = join(v, VAULT_SWIPE, d);
    const a = analisarPasta(abs, rel);
    out.push({ rel: rel(abs), nome: d, grupo: "Swipe · Funis e páginas capturadas", fonte: "swipe", tipo: tipoPorNome(d), capa: capaDaPasta(abs, a, rel), abrir: a.entrada ?? rel(abs), ...a });
  }
  // 3) Clones de trabalho do editor de referências: site/index.html é a página.
  for (const d of dirs(join(v, VAULT_TRAB))) {
    const abs = join(v, VAULT_TRAB, d);
    const t = lerJson<{ nome?: string; name?: string }>(join(abs, "trabalho.json"));
    const a = analisarPasta(abs, rel);
    out.push({ rel: rel(abs), nome: t?.nome ?? t?.name ?? d, grupo: "Trabalhos (clones editáveis)", fonte: "trabalho", tipo: "pagina", capa: capaDaPasta(abs, a, rel), abrir: a.entrada ?? rel(abs), ...a });
  }
  return out;
}

/** Ficha de uma página do vault pelo caminho (pasta, entrada ou qualquer arquivo de dentro dela). */
export function paginaVault(relPath: string): PaginaVault {
  const rel = vaultRel(relPath);
  if (!rel) throw new HttpError(400, "Informe o caminho");
  const todas = paginasVault();
  const p = todas.find((x) => x.rel === rel || x.entrada === rel || x.abrir === rel)
    ?? todas.find((x) => rel.startsWith(x.rel + "/") || x.arquivos.some((a) => a.rel === rel));
  if (!p) throw new HttpError(404, "Página não encontrada no vault");
  return p;
}

// ---------- servir páginas do vault (por http, em sandbox) ----------

/**
 * Lê um arquivo de página do vault para servir em /vault/<rel>. HTML ganha CSP `sandbox` (origem opaca: os scripts
 * da página capturada não alcançam a API do Hub); MHTML é convertido em HTML com os recursos embutidos.
 */
export async function servirVault(relPath: string): Promise<{ abs: string; tipo: string; html: boolean; conteudo?: string | Uint8Array } | null> {
  const abs = vaultAbs(relPath);
  if (!statSync(abs).isFile()) return null;
  const ext = extname(abs).toLowerCase();
  if ([".html", ".htm", ".mhtml", ".mht"].includes(ext)) lembrarRaiz(abs);
  if (ext === ".mhtml" || ext === ".mht") return { abs, conteudo: await mhtmlParaHtml(abs), tipo: "text/html; charset=utf-8", html: true };
  if (ext === ".html" || ext === ".htm") {
    // Bytes originais preservados (latin1 ida e volta): só o shim ASCII entra, qualquer charset da página continua igual.
    const bruto = Buffer.from(await Bun.file(abs).arrayBuffer()).toString("latin1");
    const m = /<head[^>]*>/i.exec(bruto);
    const pos = m ? m.index + m[0].length : 0;
    return { abs, conteudo: Buffer.from(bruto.slice(0, pos) + SHIM_SANDBOX + bruto.slice(pos), "latin1"), tipo: "text/html", html: true };
  }
  return { abs, tipo: MIME_VAULT[ext] ?? "application/octet-stream", html: ext === ".svg" };
}

/**
 * Página salva com caminho absoluto ("/_next/static/x.js", comum em Next/Vite) pede o arquivo na raiz do Hub.
 * O Hub lembra as pastas das páginas do vault abertas por último (da pasta da página até a captura) e procura o
 * arquivo nelas. Só arquivos com extensão, só dentro das pastas de páginas do vault.
 */
const raizesRecentes: string[] = [];

function lembrarRaiz(pagina: string) {
  const base = resolve(vaultRoot());
  const raizes = VAULT_RAIZES.map((r) => join(base, r));
  let d = resolve(pagina, "..");
  const cadeia: string[] = [];
  while (d.startsWith(base + sep) && !raizes.includes(d)) { cadeia.push(d); d = resolve(d, ".."); }
  for (const c of cadeia.reverse()) {
    const i = raizesRecentes.indexOf(c);
    if (i >= 0) raizesRecentes.splice(i, 1);
    raizesRecentes.unshift(c);
  }
  raizesRecentes.splice(40);
}

/** Caminho relativo do vault para um pedido "/algo.ext" vindo de uma página do vault, ou null. */
export function vaultPorRaizRecente(caminho: string): string | null {
  if (!extname(caminho) || caminho.split("/").includes("..")) return null;
  const base = resolve(vaultRoot());
  for (const r of raizesRecentes) {
    const abs = resolve(r, "." + caminho);
    if (!abs.startsWith(r + sep)) continue;
    try { if (statSync(abs).isFile()) return relative(base, abs).split(sep).join("/"); } catch { /* segue */ }
  }
  return null;
}

/**
 * Em sandbox (origem opaca) localStorage/sessionStorage/cookie lançam erro e derrubam o JS de muita página capturada.
 * O shim troca por armazenamento em memória, só dentro da página.
 */
const SHIM_SANDBOX = `<script>(function(){function m(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].length}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}});try{document.cookie}catch(e){try{var c="";Object.defineProperty(document,"cookie",{get:function(){return c},set:function(v){c=String(v).split(";")[0]},configurable:true})}catch(_){}}})();</script>`;

const MIME_VAULT: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff",
  ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
};

const cacheMhtml = new Map<string, string>();

function decodeQP(s: string): Buffer {
  const semQuebra = s.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < semQuebra.length; i++) {
    const c = semQuebra[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(semQuebra.slice(i + 1, i + 3))) { bytes.push(parseInt(semQuebra.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(semQuebra.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes);
}

/** MHTML (página salva pelo Chrome) → um HTML só, com imagens/CSS como data: URI. O navegador não abre MHTML por http. */
export async function mhtmlParaHtml(abs: string): Promise<string> {
  const chave = `${abs}:${statSync(abs).mtimeMs}`;
  const pronto = cacheMhtml.get(chave);
  if (pronto) return pronto;
  const bruto = Buffer.from(await Bun.file(abs).arrayBuffer()).toString("latin1");
  const b = bruto.match(/boundary="?([^";\r\n]+)"?/i)?.[1];
  if (!b) throw new HttpError(422, "MHTML sem boundary");
  const partes = bruto.split(`--${b}`).slice(1).filter((p) => !p.startsWith("--"));
  type Parte = { tipo: string; local: string | null; cid: string | null; dados: Buffer };
  const lidas: Parte[] = partes.map((p) => {
    const corte = p.search(/\r?\n\r?\n/);
    const cab = p.slice(0, corte), corpo = p.slice(corte).replace(/^\r?\n\r?\n/, "");
    const h = (n: string) => cab.match(new RegExp(`^${n}:\\s*(.+)$`, "im"))?.[1].trim() ?? null;
    const enc = (h("Content-Transfer-Encoding") ?? "").toLowerCase();
    const dados = enc === "base64" ? Buffer.from(corpo.replace(/\s+/g, ""), "base64") : enc === "quoted-printable" ? decodeQP(corpo) : Buffer.from(corpo, "latin1");
    return { tipo: (h("Content-Type") ?? "application/octet-stream").split(";")[0].trim(), local: h("Content-Location"), cid: h("Content-ID")?.replace(/[<>]/g, "") ?? null, dados };
  });
  const principal = lidas.find((p) => p.tipo === "text/html");
  if (!principal) throw new HttpError(422, "MHTML sem HTML");
  const uri = new Map<string, string>();
  // CSS primeiro sem trocar nada dentro; imagens e fontes viram data: URI.
  for (const p of lidas) {
    if (p === principal) continue;
    const u = `data:${p.tipo};base64,${p.dados.toString("base64")}`;
    if (p.local) uri.set(p.local, u);
    if (p.cid) uri.set(`cid:${p.cid}`, u);
  }
  let html = principal.dados.toString("utf8");
  // Do maior para o menor: evita trocar um prefixo de outra URL.
  for (const [k, u] of [...uri.entries()].sort((a, b) => b[0].length - a[0].length)) {
    if (!html.includes(k)) continue;
    html = html.split(k).join(u);
  }
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  if (cacheMhtml.size > 12) cacheMhtml.delete(cacheMhtml.keys().next().value!);
  cacheMhtml.set(chave, html);
  return html;
}

/** Caminho absoluto de algo do vault, só dentro das raízes de páginas. */
export function vaultAbs(relPath: string): string {
  const rel = vaultRel(relPath);
  if (!rel) throw new HttpError(400, "Informe o caminho");
  const base = resolve(vaultRoot());
  const abs = resolve(base, rel);
  if (!abs.startsWith(base + sep)) throw new HttpError(400, "Caminho do vault inválido");
  if (!existsSync(abs)) throw new HttpError(404, "Arquivo não encontrado no vault");
  return abs;
}

export function vaultImagem(relPath: string): string {
  const abs = vaultAbs(relPath);
  if (!IMG_EXT.has(extname(abs).toLowerCase()) || !statSync(abs).isFile()) throw new HttpError(400, "Só imagens");
  return abs;
}

// ---------- swipes ----------

function tipoSwipe(v: unknown): TipoSwipe {
  if (!TIPOS_SWIPE.includes(v as TipoSwipe)) throw new HttpError(400, `Tipo de swipe inválido (use ${TIPOS_SWIPE.join(", ")})`);
  return v as TipoSwipe;
}

function acharSwipe(root: string, id: string): { abs: string; item: Swipe } | null {
  if (!idValido(id)) return null;
  for (const s of SWIPES) {
    const abs = join(pastaSwipe(root, s.tipo), `${id}.json`);
    if (existsSync(abs)) {
      const item = lerJson<Swipe>(abs);
      if (item) return { abs, item };
    }
  }
  return null;
}

const imagemUrl = (s: Swipe) => (s.imagem ? `/api/swipes/${s.id}/imagem?v=${encodeURIComponent(s.atualizado_em)}` : null);
/** URL /vault/... de um caminho relativo do vault (segmento a segmento). */
export const vaultUrl = (rel: string | null | undefined) => (rel ? `/vault/${rel.split("/").map(encodeURIComponent).join("/")}` : null);

/** Resumo da página do vault para cartões e etapas: capa, arquivo principal e quantidade de capturas. */
function resumoVault(rel: string, vault?: Map<string, PaginaVault>) {
  const p = (vault ?? indiceVault()).get(rel) ?? null;
  if (!p) return { rel, nome: basename(rel), capa: null, entrada: null, arquivos: 0, imagens: 0, ausente: !existsSync(join(vaultRoot(), rel)) };
  return { rel: p.rel, nome: p.nome, capa: vaultUrl(p.capa), entrada: vaultUrl(p.entrada), arquivos: p.arquivos.length, imagens: p.imagens.length, ausente: false };
}

const comUrl = (s: Swipe, vault?: Map<string, PaginaVault>) => {
  const v = s.vault ? resumoVault(s.vault, vault) : null;
  return { ...s, imagem_url: imagemUrl(s), vault_info: v, capa_url: imagemUrl(s) ?? v?.capa ?? null };
};

export function listarSwipes(root: string, filtro: { tipo?: string | null; profile?: string | null; q?: string | null } = {}) {
  const tipos = filtro.tipo ? [tipoSwipe(filtro.tipo)] : TIPOS_SWIPE;
  const q = filtro.q ? expertSlug(filtro.q) : "";
  const out: Swipe[] = [];
  const vault = indiceVault();
  for (const t of tipos) {
    const dir = pastaSwipe(root, t);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const s = lerJson<Swipe>(join(dir, f));
      if (!s) continue;
      if (filtro.profile && s.expert !== filtro.profile) continue;
      if (q && !expertSlug([s.titulo, s.autor, s.texto, s.notas, s.tags.join(" "), s.url].join(" ")).includes(q)) continue;
      out.push(s);
    }
  }
  out.sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
  return { total: out.length, por_tipo: Object.fromEntries(SWIPES.map((s) => [s.tipo, out.filter((x) => x.tipo === s.tipo).length])), itens: out.map((s) => comUrl(s, vault)) };
}

function normalizarSwipe(b: any, base?: Swipe): Omit<Swipe, "id" | "criado_em" | "atualizado_em" | "imagem" | "schema"> {
  const tipo = base?.tipo ?? tipoSwipe(b?.tipo);
  const pick = <K extends keyof Swipe>(k: K, f: (v: unknown) => Swipe[K]) => (b && k in b ? f(b[k]) : base ? base[k] : f(undefined));
  const titulo = pick("titulo", (v) => str(v, 200).trim());
  if (!titulo) throw new HttpError(400, "Dê um título ao swipe");
  return {
    tipo,
    titulo,
    subtipo: tipo === "pagina" ? pick("subtipo", (v) => (SUBTIPOS_PAGINA.includes(v as any) ? (v as string) : "vendas")) : null,
    origem: pick("origem", origem),
    expert: pick("expert", (v) => strOuNull(v, 120)),
    autor: pick("autor", (v) => str(v, 120).trim()),
    url: pick("url", (v) => urlOk(v) ?? ""),
    texto: pick("texto", (v) => str(v, 20000)),
    notas: pick("notas", (v) => str(v, 5000)),
    tags: pick("tags", (v) => (Array.isArray(v) ? [...new Set(v.map((t) => str(t, 40).trim()).filter(Boolean))].slice(0, 20) : [])),
    vault: pick("vault", vaultRel),
  };
}

export function criarSwipe(root: string, b: any) {
  const dados = normalizarSwipe(b);
  const t = now();
  const item: Swipe = { schema: "irh-swipe/v1", id: novoId(dados.titulo), ...dados, imagem: null, criado_em: t, atualizado_em: t };
  gravarJson(join(pastaSwipe(root, item.tipo), `${item.id}.json`), item);
  return comUrl(item);
}

export function atualizarSwipe(root: string, id: string, b: any) {
  const f = acharSwipe(root, id);
  if (!f) throw new HttpError(404, "Swipe não encontrado");
  const item: Swipe = { ...f.item, ...normalizarSwipe(b, f.item), atualizado_em: now() };
  gravarJson(f.abs, item);
  return comUrl(item);
}

export function apagarSwipe(root: string, id: string) {
  const f = acharSwipe(root, id);
  if (!f) throw new HttpError(404, "Swipe não encontrado");
  if (f.item.imagem) rmSync(join(pastaSwipe(root, f.item.tipo), f.item.imagem), { force: true });
  rmSync(f.abs, { force: true });
  return { ok: true };
}

export async function gravarImagemSwipe(root: string, id: string, file: File) {
  const f = acharSwipe(root, id);
  if (!f) throw new HttpError(404, "Swipe não encontrado");
  const ext = extname(file.name).toLowerCase() || ({ "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" } as Record<string, string>)[file.type] || "";
  if (!IMG_EXT.has(ext)) throw new HttpError(400, "Envie uma imagem (png, jpg, webp ou gif)");
  if (file.size > MAX_IMG) throw new HttpError(400, "Imagem acima de 15 MB");
  const dir = pastaSwipe(root, f.item.tipo);
  if (f.item.imagem) rmSync(join(dir, f.item.imagem), { force: true });
  const nome = `${id}${ext === ".jpeg" ? ".jpg" : ext}`;
  await Bun.write(join(dir, nome), file);
  const item: Swipe = { ...f.item, imagem: nome, atualizado_em: now() };
  gravarJson(f.abs, item);
  return comUrl(item);
}

export function imagemSwipe(root: string, id: string): string {
  const f = acharSwipe(root, id);
  if (!f?.item.imagem) throw new HttpError(404, "Swipe sem imagem");
  const abs = join(pastaSwipe(root, f.item.tipo), basename(f.item.imagem));
  if (!existsSync(abs)) throw new HttpError(404, "Imagem não encontrada no disco");
  return abs;
}

// ---------- funis ----------

const funilPath = (root: string, id: string) => {
  if (!idValido(id)) throw new HttpError(400, "ID de funil inválido");
  return join(funisDir(root), `${id}.json`);
};

function lerFunil(root: string, id: string): Funil {
  const abs = funilPath(root, id);
  const f = existsSync(abs) ? lerJson<Funil>(abs) : null;
  if (!f) throw new HttpError(404, "Funil não encontrado");
  return f;
}

function normalizarEtapas(v: unknown): Etapa[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  return v.slice(0, 200).flatMap((e: any): Etapa[] => {
    const id = str(e?.id, 40);
    if (!/^[\w-]{1,40}$/.test(id) || vistos.has(id) || !TIPOS_ETAPA.includes(e?.tipo)) return [];
    vistos.add(id);
    return [{
      id, tipo: e.tipo, titulo: str(e.titulo, 200), texto: str(e.texto, 5000),
      x: num(e.x), y: num(e.y),
      ref: strOuNull(e.ref, 40), producao: /^[\w.:-]{1,200}$/.test(str(e.producao, 200)) ? str(e.producao, 200) : null,
      swipe: strOuNull(e.swipe, 90), vault: vaultRel(e.vault), url: urlOk(e.url),
    }];
  });
}

function normalizarConexoes(v: unknown, etapas: Etapa[]): Conexao[] {
  if (!Array.isArray(v)) return [];
  const ids = new Set(etapas.map((e) => e.id));
  const pares = new Set<string>();
  return v.slice(0, 400).flatMap((c: any): Conexao[] => {
    const de = str(c?.de, 40), para = str(c?.para, 40);
    if (!ids.has(de) || !ids.has(para) || de === para || pares.has(`${de}>${para}`)) return [];
    pares.add(`${de}>${para}`);
    const p = c.percentual === null || c.percentual === "" || c.percentual === undefined ? null : Math.max(0, Math.min(100, num(c.percentual)));
    return [{ id: /^[\w-]{1,40}$/.test(str(c.id, 40)) ? str(c.id, 40) : `c-${sufixo()}`, de, para, rotulo: str(c.rotulo, 120), percentual: p }];
  });
}

function normalizarFunil(b: any, base?: Funil): Omit<Funil, "schema" | "id" | "criado_em" | "atualizado_em"> {
  const has = (k: string) => b && k in b;
  const nome = has("nome") ? str(b.nome, 160).trim() : base?.nome ?? "";
  if (!nome) throw new HttpError(400, "Dê um nome ao funil");
  const etapas = has("etapas") ? normalizarEtapas(b.etapas) : base?.etapas ?? [];
  return {
    nome,
    origem: has("origem") ? origem(b.origem) : base?.origem ?? "referencia",
    expert: has("expert") ? strOuNull(b.expert, 120) : base?.expert ?? null,
    descricao: has("descricao") ? str(b.descricao, 5000) : base?.descricao ?? "",
    status: has("status") && ["rascunho", "ativo", "pausado", "arquivado"].includes(b.status) ? b.status : base?.status ?? "rascunho",
    etapas,
    conexoes: has("conexoes") || has("etapas") ? normalizarConexoes(has("conexoes") ? b.conexoes : base?.conexoes, etapas) : base?.conexoes ?? [],
  };
}

/** Legenda do post produzido: a do post no ar (consultada pelo link) ou a V1 preparada na Publicação. */
function legendaProducao(root: string, ref: string, slug: string): string | null {
  const ler = (n: string) => { try { return JSON.parse(readFileSync(join(root, "replicacoes", ref, slug, n), "utf8")); } catch { return null; } };
  return ler("flow-producao.json")?.publicacaoInfo?.legenda || ler("legendas-post.json")?.versoes?.[0]?.texto || null;
}

export type ProducaoInfo = {
  id: string; tipo: "video" | "carrossel"; titulo: string; perfil: string | null; etapa: string; hub_url: string | null;
  capa: string | null; video: string | null; slides: string[]; legenda: string | null; post_url: string | null; postado_em: string | null;
};

/** Posts do próprio expert feitos no Hub (vídeos da Replicação e carrosséis), para vincular em etapa de post. */
export function postsProduzidos(ctx: Ctx, profile?: string | null): ProducaoInfo[] {
  let videos: any[] = [];
  try { videos = (listPipeline(ctx, profile || null) as any).itens ?? []; } catch { videos = []; }
  const v = videos.filter((i) => i.editado_url || i.post_url).map((i): ProducaoInfo => ({
    id: i.id, tipo: "video", titulo: i.ref, perfil: i.client_name ?? null, etapa: i.etapa, hub_url: i.hub_url ?? null,
    // Capa nula de propósito: a capa da produção é a da referência; a tela usa o 1º quadro do vídeo editado.
    capa: i.editado_url ? null : i.capa_url ?? null, video: i.editado_url ?? null, slides: [], legenda: legendaProducao(ctx.root, i.ref, i.client_slug),
    post_url: i.post_url ?? null, postado_em: i.postado_em ?? null,
  }));
  let cars: Carrossel[] = [];
  try { cars = listarCarrosseis(profile || null); } catch { cars = []; }
  const c = cars.filter((x) => x.prontos > 0).map((x): ProducaoInfo => {
    const slides = x.slides.map((s) => s.replicado).filter((u): u is string => !!u);
    return { id: `car:${x.id}`, tipo: "carrossel", titulo: `${x.lote ?? ""} · ${x.titulo ?? x.post}`.replace(/^ · /, ""), perfil: x.perfil?.name ?? null, hub_url: `/carrossel/${x.id}`,
      etapa: x.etapa, capa: slides[0] ?? x.capa ?? null, video: null, slides, legenda: x.legenda || null, post_url: x.url ?? null,
      postado_em: [x.publicacao, x.data].find((d) => d && /^\d{4}-\d{2}-\d{2}/.test(d)) ?? null };
  });
  return [...v, ...c].sort((a, b) => String(b.postado_em ?? "").localeCompare(String(a.postado_em ?? "")) || a.titulo.localeCompare(b.titulo));
}

/** Etapa com o que o vínculo aponta já resolvido (capa do post, print do swipe, capa da página do vault). */
function resolverEtapas(ctx: Ctx, f: Funil, vault: Map<string, PaginaVault>) {
  const refQ = ctx.db.query("SELECT id, username, caption, url, thumb_path FROM refs WHERE id = ?");
  const prod = f.etapas.some((e) => e.producao) ? new Map(postsProduzidos(ctx).map((p) => [p.id, p])) : null;
  return f.etapas.map((e) => {
    const r = e.ref ? (refQ.get(e.ref) as any) : null;
    const s = e.swipe ? acharSwipe(ctx.root, e.swipe)?.item ?? null : null;
    const p = e.vault ? vault.get(e.vault) ?? null : null;
    return {
      ...e,
      ref_info: e.ref ? (r ? { id: r.id, username: r.username, legenda: str(r.caption, 160), url: r.url, capa: r.thumb_path ? `/media/${String(r.thumb_path).split("/").map(encodeURIComponent).join("/")}` : null } : { id: e.ref, ausente: true }) : null,
      swipe_info: e.swipe ? (s ? (() => { const c = comUrl(s, vault); return { id: s.id, tipo: s.tipo, titulo: s.titulo, texto: s.texto, autor: s.autor, url: s.url, imagem: c.capa_url, vault: c.vault_info }; })() : { id: e.swipe, ausente: true }) : null,
      vault_info: e.vault ? resumoVault(p?.rel ?? e.vault, vault) : null,
      producao_info: e.producao ? prod?.get(e.producao) ?? { id: e.producao, ausente: true } : null,
    };
  });
}

function indiceVault() { return new Map(paginasVault().flatMap((p) => [[p.rel, p] as const, [p.abrir, p] as const, ...(p.entrada ? [[p.entrada, p] as const] : [])])); }

/** Aliases de perfil: o painel pode pedir pelo slug antigo. */
function slugsDoPerfil(ctx: Ctx, profile: string): Set<string> {
  const p = ctx.db.query("SELECT slug, aliases FROM profiles WHERE slug = ? OR aliases LIKE ?").get(profile, `%"${profile}"%`) as { slug: string; aliases: string } | null;
  const out = new Set([profile]);
  if (p) { out.add(p.slug); for (const a of JSON.parse(p.aliases || "[]") as string[]) out.add(a); }
  return out;
}

export function listarFunis(ctx: Ctx, opts: { profile?: string | null; completo?: boolean } = {}) {
  const dir = funisDir(ctx.root);
  const slugs = opts.profile ? slugsDoPerfil(ctx, opts.profile) : null;
  const funis = (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [])
    .map((f) => lerJson<Funil>(join(dir, f)))
    .filter((f): f is Funil => !!f && (!slugs || (!!f.expert && slugs.has(f.expert))))
    .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
  const vault = opts.completo ? indiceVault() : null;
  return {
    total: funis.length,
    gerado_em: now(),
    funis: funis.map((f) => opts.completo
      ? { ...f, etapas: resolverEtapas(ctx, f, vault!) }
      : { ...f, etapas_total: f.etapas.length, tipos: [...new Set(f.etapas.map((e) => e.tipo))] }),
  };
}

export function obterFunil(ctx: Ctx, id: string) {
  const f = lerFunil(ctx.root, id);
  return { ...f, etapas: resolverEtapas(ctx, f, indiceVault()) };
}

export function criarFunil(ctx: Ctx, b: any) {
  const dados = normalizarFunil(b);
  const t = now();
  const f: Funil = { schema: "irh-funil/v1", id: novoId(dados.nome), ...dados, criado_em: t, atualizado_em: t };
  gravarJson(funilPath(ctx.root, f.id), f);
  return obterFunil(ctx, f.id);
}

export function salvarFunil(ctx: Ctx, id: string, b: any) {
  const base = lerFunil(ctx.root, id);
  const f: Funil = { ...base, ...normalizarFunil(b, base), atualizado_em: now() };
  gravarJson(funilPath(ctx.root, id), f);
  return obterFunil(ctx, id);
}

export function apagarFunil(ctx: Ctx, id: string) {
  const abs = funilPath(ctx.root, id);
  if (!existsSync(abs)) throw new HttpError(404, "Funil não encontrado");
  rmSync(abs);
  return { ok: true };
}

/** Copia um funil (ex.: o de referência vira o funil atual do expert, com as mesmas etapas e vínculos). */
export function duplicarFunil(ctx: Ctx, id: string, b: any) {
  const base = lerFunil(ctx.root, id);
  return criarFunil(ctx, {
    ...base,
    nome: str(b?.nome, 160).trim() || `${base.nome} (cópia)`,
    origem: b?.origem ?? base.origem,
    expert: b && "expert" in b ? b.expert : base.expert,
    status: "rascunho",
  });
}
