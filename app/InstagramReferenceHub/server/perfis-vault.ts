import { publicacaoDe, resumirPublicacoes } from './publication-state';
// Entregas que moram na pasta do perfil no vault (profiles.vault_path), lidas só por arquivo:
// - vídeo final: <perfil>/07_entregas/**/videos-finais/**/<REF>*.mp4 → a replicação fica "pronto";
// - carrossel:  <perfil>/Conteúdo/**/<Post>/{originais,imagens,legendas.md,NN-geracao*.json,carrossel.zip}.
// Calendário e publicação de carrossel vêm de <perfil>/06_roadmap/Postagens.md (`pasta:`, `data:`, `publicacao:`, `url:`).
// Nada aqui escreve no vault.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { vaultRoot } from "./funis";

let DB: Database | null = null;
export function registrarPerfisVault(db: Database) { DB = db; }

const IMAGENS = /\.(png|jpe?g|webp)$/i;
const natural = (a: string, b: string) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });
const dentro = (raiz: string, p: string) => { const r = relative(raiz, p); return !!r && !r.startsWith("..") && !isAbsolute(r); };
const ler = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const subdirs = (d: string) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name); } catch { return []; } };
const arquivos = (d: string, re: RegExp) => { try { return readdirSync(d).filter((f) => re.test(f) && !f.startsWith(".")).sort(natural); } catch { return []; } };
export const slugify = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export type PerfilVault = { slug: string; name: string; pasta: string; personagens: { slug: string; name: string }[] };

// Uma listagem síncrona pergunta a mesma coisa centenas de vezes. Dentro de lerUmaVez, cada resposta sai do disco uma vez só.
// Vale apenas para leitura: nada dentro do escopo pode gravar no vault.
let escopo: Map<string, unknown> | null = null;
export function lerUmaVez<T>(fn: () => T): T {
  if (escopo) return fn();
  escopo = new Map();
  try { return fn(); } finally { escopo = null; }
}
function memo<T>(chave: string, fn: () => T): T {
  if (!escopo) return fn();
  if (!escopo.has(chave)) escopo.set(chave, fn());
  return escopo.get(chave) as T;
}

/** Perfis com pasta existente no vault (real, dentro do vault). */
export function perfisVault(): PerfilVault[] { return memo("perfis", lerPerfisVault); }
function lerPerfisVault(): PerfilVault[] {
  if (!DB) return [];
  const v = vaultRoot();
  const raiz = existsSync(v) ? realpathSync(v) : v;
  let linhas: any[] = [];
  // Banco fechado (outro servidor no mesmo processo, nos testes) = sem perfis; nunca derruba a leitura da replicação.
  try { linhas = DB.query("SELECT p.slug, p.name, p.vault_path, c.slug AS cslug, c.name AS cname FROM profiles p LEFT JOIN clients c ON c.profile_id = p.id WHERE p.vault_path IS NOT NULL ORDER BY p.id, c.id").all() as any[]; } catch { return []; }
  const out = new Map<string, PerfilVault>();
  for (const l of linhas) {
    let p = out.get(l.slug);
    if (!p) {
      const abs = join(raiz, l.vault_path);
      if (!existsSync(abs)) continue;
      const real = realpathSync(abs);
      if (!dentro(raiz, real)) continue;
      p = { slug: l.slug, name: l.name, pasta: real, personagens: [] };
      out.set(l.slug, p);
    }
    if (l.cslug) p.personagens.push({ slug: l.cslug, name: l.cname });
  }
  return [...out.values()];
}
const perfilDoPersonagem = (slug: string) => perfisVault().find((p) => p.personagens.some((c) => c.slug === slug)) ?? null;

// ---------------------------------------------------------------- vídeo final
function mp4sFinais(dir: string, prof = 0, emFinais = false, out: string[] = []): string[] {
  if (prof > 6) return out;
  let itens: import("node:fs").Dirent[] = [];
  try { itens = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of itens) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) mp4sFinais(p, prof + 1, emFinais || e.name === "videos-finais", out);
    else if (emFinais && /\.mp4$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** Vídeo final do personagem na pasta do perfil: nome começa com a REF; com mais de um personagem, o que cita o dele vence. */
export function videoFinalVault(ref: string, slug: string): string | null {
  const perfil = perfilDoPersonagem(slug);
  if (!perfil) return null;
  const outros = perfil.personagens.filter((c) => c.slug !== slug).map((c) => c.slug.split("-").pop()!);
  const meu = slug.split("-").pop()!;
  const cands = memo(`mp4:${perfil.pasta}`, () => mp4sFinais(join(perfil.pasta, "07_entregas"))).filter((p) => basename(p).toUpperCase().startsWith(ref.toUpperCase()) && !/_celular/i.test(p))
    .map((p) => { const n = slugify(basename(p)); return { p, meu: n.includes(meu) ? 1 : 0, outro: outros.some((o) => n.includes(o)), postado: p.includes("/postados/") ? 1 : 0, mtime: statSync(p).mtimeMs }; })
    .filter((c) => !c.outro || c.meu)
    .sort((a, b) => b.meu - a.meu || b.postado - a.postado || b.mtime - a.mtime);
  return cands[0]?.p ?? null;
}

// ---------------------------------------------------------------- carrosséis
type Campos = Record<string, string>;
/** Seções `## ` de Postagens.md com os campos `chave: valor`. */
function postagens(pasta: string): { titulo: string; c: Campos }[] {
  const t = ler(join(pasta, "06_roadmap", "Postagens.md")).replace(/```[\s\S]*?```/g, "");
  return t.split(/^## /m).slice(1).map((parte) => {
    const [titulo, ...resto] = parte.split("\n");
    const c: Campos = {};
    for (const m of resto.join("\n").matchAll(/^([a-z_]+): *(.*)$/gm)) c[m[1]] = m[2].trim();
    return { titulo: titulo.trim(), c };
  });
}

export type EtapaCarrossel = "prompts" | "gerando" | "pronto" | "postado";
export type Slide = { n: number; original: string | null; replicado: string | null };
export type Carrossel = {
  id: string; perfil: { slug: string; name: string }; personagem: string | null; lote: string; post: string; titulo: string;
  pasta: string; rel: string; etapa: EtapaCarrossel; quantidade: number; prontos: number; geracoes: number; reprovadas: number;
  slides: Slide[]; capa: string | null; legenda: string; zip: string | null;
  stage?: "producao" | "pronta" | "agendada" | "postada"; agendado_para?: string | null; late?: boolean; arquivado?: boolean; data: string | null; publicacao: string | null; url: string | null; postagem_id: string | null;
};

const urlArquivo = (id: string, rel: string) => `/api/carrosseis/${id}/arquivo?p=${encodeURIComponent(rel)}`;

/** Pastas de post: dentro de Conteúdo/, qualquer pasta com originais/ ou imagens/ (até 4 níveis). */
function pastasDePost(dir: string, prof = 0, out: string[] = []): string[] {
  if (prof > 4) return out;
  const subs = subdirs(dir);
  if (prof > 0 && (subs.includes("originais") || subs.includes("imagens"))) { out.push(dir); return out; }
  for (const s of subs) if (!["reprovadas", "prints"].includes(s)) pastasDePost(join(dir, s), prof + 1, out);
  return out;
}

function montarCarrossel(perfil: PerfilVault, dir: string, notas: { titulo: string; c: Campos }[]): Carrossel {
  const rel = relative(perfil.pasta, dir);
  const post = basename(dir), lote = basename(join(dir, ".."));
  const id = `${perfil.slug}--${slugify(lote)}--${slugify(post)}`.slice(0, 160);
  const md = ler(join(dir, `${post}.md`));
  const h1 = md.match(/^# (.+)$/m)?.[1]?.trim() ?? "";
  const ligadas = notas.filter(n => (n.c.pasta ?? "").replace(/\/+$/, "") === rel);
  const nota = ligadas.find(n => publicacaoDe(n.c) === 'a_publicar') ?? ligadas[0];
  const titulo = (nota?.titulo ?? h1).replace(/^Post\s*\d+\s*[—–-]\s*/i, "").trim() || post;
  const personagem = md.match(/Personagem:\s*([^.\n]+)/i)?.[1]?.trim() ?? null;
  const originais = arquivos(join(dir, "originais"), IMAGENS);
  const imagens = arquivos(join(dir, "imagens"), IMAGENS);
  const geracoes = arquivos(dir, /^\d+-geracao.*\.json$/i).length;
  const reprovadas = arquivos(join(dir, "reprovadas"), IMAGENS).length;
  const num = (f: string) => Number(f.match(/^(\d+)/)?.[1] ?? NaN);
  const quantidade = Math.max(Number(nota?.c.quantidade) || 0, originais.length, imagens.length);
  const slides: Slide[] = [];
  for (let n = 1; n <= quantidade; n++) {
    const o = originais.find((f) => num(f) === n) ?? (originais.every((f) => isNaN(num(f))) ? originais[n - 1] : undefined);
    const r = imagens.find((f) => num(f) === n) ?? (imagens.every((f) => isNaN(num(f))) ? imagens[n - 1] : undefined);
    slides.push({ n, original: o ? urlArquivo(id, `originais/${o}`) : null, replicado: r ? urlArquivo(id, `imagens/${r}`) : null });
  }
  const prontos = slides.filter((s) => s.replicado).length;
  const url = (nota?.c.url ?? "").trim() || null;
  const publicacao = resumirPublicacoes(ligadas.map(n=>n.c));
  const etapa: EtapaCarrossel = publicacao === "postado" ? "postado"
    : quantidade > 0 && prontos === quantidade ? "pronto" : prontos > 0 || geracoes > 0 ? "gerando" : "prompts";
  const data = nota?.c.data || null;
  const hoje = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const agendado_para = data ? `${data}T${nota?.c.hora || '12:00'}:00-03:00` : null;
  const stage = etapa === 'postado' ? 'postada' : etapa !== 'pronto' ? 'producao' : data && data >= hoje ? 'agendada' : 'pronta';
  const legFile = nota?.c.legenda_arquivo ? join(perfil.pasta, nota.c.legenda_arquivo) : join(dir, "legendas.md");
  return {
    id, perfil: { slug: perfil.slug, name: perfil.name }, personagem, lote, post, titulo, pasta: dir, rel, etapa, quantidade, prontos, geracoes, reprovadas,
    slides, capa: slides.find((s) => s.replicado)?.replicado ?? slides[0]?.original ?? null,
    legenda: dentro(perfil.pasta, legFile) ? ler(legFile).trim() : "", zip: existsSync(join(dir, "carrossel.zip")) ? urlArquivo(id, "carrossel.zip") : null,
    stage, agendado_para, late: publicacao === "a_publicar" && !!data && data < hoje, arquivado: publicacao === "arquivado", data: nota?.c.data || null, publicacao, url, postagem_id: nota?.c.id || null,
  };
}

export function listarCarrosseis(perfilSlug?: string | null): Carrossel[] {
  const out: Carrossel[] = [];
  for (const p of perfisVault()) {
    if (perfilSlug && p.slug !== perfilSlug && !p.personagens.some((c) => c.slug === perfilSlug)) continue;
    const notas = postagens(p.pasta);
    for (const conteudo of subdirs(p.pasta).filter((d) => /^conte[uú]do$/i.test(d.normalize("NFC"))))
      for (const dir of pastasDePost(join(p.pasta, conteudo))) out.push(montarCarrossel(p, dir, notas));
  }
  return out.sort((a, b) => a.perfil.name.localeCompare(b.perfil.name) || natural(a.rel, b.rel));
}

export function obterCarrossel(id: string): Carrossel | null {
  return listarCarrosseis().find((c) => c.id === id) ?? null;
}

/** Arquivo de dentro da pasta do post (imagem ou carrossel.zip). */
export function arquivoCarrossel(id: string, rel: string): string | null {
  const c = obterCarrossel(id);
  if (!c || !rel || rel.split("/").includes("..")) return null;
  const abs = join(c.pasta, rel);
  if (!existsSync(abs)) return null;
  const real = realpathSync(abs);
  return dentro(realpathSync(c.pasta), real) && (IMAGENS.test(real) || basename(real) === "carrossel.zip") ? real : null;
}

// ---------------------------------------------------------------- legenda do post
const blocoLegenda = (sec: string) => sec.match(/```legenda\n([\s\S]*?)```/)?.[1].trim() || null;

/** Legenda do post na nota do perfil: seção de Postagens.md com `ref: <REF>` (bloco ```legenda ou `legenda_de: Posts.md#NN`). */
export function legendaVault(ref: string, slug: string): string | null {
  const perfil = perfilDoPersonagem(slug) ?? perfisVault().find((p) => p.slug === slug) ?? null;
  if (!perfil) return null;
  const secoes = ler(join(perfil.pasta, "06_roadmap", "Postagens.md")).split(/^## /m).slice(1);
  const minha = secoes.filter((s) => new RegExp(`^ref: *${ref}\\s*$`, "mi").test(s.replace(/```[\s\S]*?```/g, "")));
  // Com dois personagens no perfil, a seção que cita o personagem vence.
  const sec = minha.find((s) => slugify(s).includes(slug.split("-").pop()!)) ?? minha[0];
  if (!sec) return null;
  const propria = blocoLegenda(sec);
  if (propria) return propria;
  const num = sec.replace(/```[\s\S]*?```/g, "").match(/^legenda_de: *Posts\.md#(\w+)/m)?.[1];
  if (!num) return null;
  const alvo = ler(join(perfil.pasta, "06_roadmap", "Posts.md")).split(/^## /m).slice(1).find((s) => s.startsWith(`${num} `) || s.startsWith(`${num}\n`));
  return alvo ? blocoLegenda(alvo) : null;
}

/** @ do perfil onde o personagem posta: `perfil:` do Postagens.md → `handle` de um legendas-post.json do personagem. */
export function handleDoPersonagem(root: string, slug: string): string | null { return memo(`handle:${root}:${slug}`, () => lerHandle(root, slug)); }
function lerHandle(root: string, slug: string): string | null {
  const perfil = perfilDoPersonagem(slug) ?? perfisVault().find((p) => p.slug === slug) ?? null;
  const fm = perfil ? ler(join(perfil.pasta, "06_roadmap", "Postagens.md")).match(/^---\n([\s\S]*?)\n---/)?.[1] : null;
  const doFm = fm?.match(/^perfil: *["']?@?([\w.]+)/m)?.[1];
  if (doFm) return doFm;
  for (const ref of subdirs(join(root, "replicacoes"))) {
    try { const h = JSON.parse(readFileSync(join(root, "replicacoes", ref, slug, "legendas-post.json"), "utf8"))?.handle; if (h) return String(h).replace(/^@/, ""); } catch { /* sem arquivo */ }
  }
  return null;
}

const escRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Legenda da referência com o perfil trocado (@ e hashtag do perfil original → os do perfil que posta). Texto intacto. */
export function trocarPerfil(legenda: string, original: string | null, handle: string | null): string {
  if (!original || !handle) return legenda;
  const o = original.replace(/^@/, ""), semPonto = (t: string) => t.replace(/[._]/g, "");
  return legenda
    .replace(new RegExp(`@${escRe(o)}(?![\\w.])`, "gi"), `@${handle}`)
    .replace(new RegExp(`#${escRe(semPonto(o))}(?!\\w)`, "gi"), `#${semPonto(handle)}`);
}

export type LegendaFonte = "post" | "adaptada" | "nota" | "referencia";
/**
 * Legenda que vai no post: a real (já publicado) → a adaptada do Hub (legendas-post.json V1) → a da nota do perfil →
 * a da referência com o perfil trocado (ainda não adaptada; `fonte: "referencia"`).
 */
export function legendaDoPost(root: string, ref: string, slug: string): { texto: string; fonte: LegendaFonte } | null {
  const json = (n: string) => { try { return JSON.parse(readFileSync(join(root, "replicacoes", ref, slug, n), "utf8")); } catch { return null; } };
  const post = json("flow-producao.json")?.publicacaoInfo?.legenda;
  if (post) return { texto: post, fonte: "post" };
  const adaptada = json("legendas-post.json")?.versoes?.[0]?.texto;
  if (adaptada) return { texto: adaptada, fonte: "adaptada" };
  const nota = legendaVault(ref, slug);
  if (nota) return { texto: nota, fonte: "nota" };
  let r: any = null;
  try { r = DB?.query("SELECT caption, username FROM refs WHERE id = ?").get(ref); } catch { r = null; }
  return r?.caption ? { texto: trocarPerfil(r.caption, r.username, handleDoPersonagem(root, slug)), fonte: "referencia" } : null;
}
