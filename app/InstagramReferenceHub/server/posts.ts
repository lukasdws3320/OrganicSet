import { publicacaoDe } from './publication-state';
export { publicacaoDe } from './publication-state';
export type { Publicacao } from './publication-state';
import type { Publicacao } from './publication-state';
// Post = uma seção `## ` do <perfil>/06_roadmap/Postagens.md no vault. É a FONTE ÚNICA de calendário e publicação:
// o Hub e o painel privado leem e gravam aqui, nunca em outro lugar. Cada variação (versão da legenda × horário × canal)
// de uma replicação é um post próprio, com estado próprio. A replicação (REF × personagem) só resume os posts dela.
//
// Campos de um post de vídeo: id, tipo (video | ia | bruno | carrossel), ref, personagem, versao (V1, V2…), canal
// (Reels teste | Feed), data, hora, publicacao (a_publicar | postado | arquivado) ou status (a postar | postado | arquivado),
// url, postado_em, arquivado_em, legenda (bloco ```legenda), legenda_de (Posts.md#NN), video.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { HttpError } from "./refs";
import { handleDoPersonagem, lerUmaVez, listarCarrosseis, perfisVault, slugify, trocarPerfil, videoFinalVault, type PerfilVault } from "./perfis-vault";
import { normalizePostUrl } from "./text";

export type Campos = Record<string, string>;
export type Secao = { titulo: string; ini: number; fim: number; texto: string; c: Campos };


const semCodigo = (t: string) => t.replace(/```[\s\S]*?```/g, "");
const ler = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const dentro = (raiz: string, p: string) => { const r = relative(raiz, p); return !!r && !r.startsWith("..") && !isAbsolute(r); };
const notaDe = (perfil: PerfilVault) => join(perfil.pasta, "06_roadmap", "Postagens.md");
const pad = (n: number) => String(n).padStart(2, "0");

/** Seções `## ` com a posição no arquivo (para regravar só a seção) e os campos `chave: valor` fora dos blocos de código. */
export function secoes(t: string): Secao[] {
  const idx = [...t.matchAll(/^## /gm)].map((m) => m.index!);
  return idx.map((ini, i) => {
    const fim = i + 1 < idx.length ? idx[i + 1] : t.length;
    const texto = t.slice(ini, fim);
    const [l1, ...resto] = texto.slice(3).split("\n");
    const c: Campos = {};
    for (const m of semCodigo(resto.join("\n")).matchAll(/^([a-z_]+): *(.*)$/gm)) if (!(m[1] in c)) c[m[1]] = m[2].trim();
    return { titulo: l1.trim(), ini, fim, texto, c };
  });
}
const ehPost = (s: Secao) => "id" in s.c || "tipo" in s.c;

/** Troca, insere (depois do último campo) ou remove (`null`) um campo da seção, fora dos blocos de código. */
export function comCampo(sec: string, nome: string, valor: string | null): string {
  const b = sec.indexOf("```");
  let cab = b >= 0 ? sec.slice(0, b) : sec;
  const resto = b >= 0 ? sec.slice(b) : "";
  const tem = new RegExp(`^${nome}:.*$`, "m");
  const linha = valor ? `${nome}: ${valor}` : `${nome}:`;
  if (valor === null) cab = cab.replace(new RegExp(`^${nome}:.*\\n?`, "m"), "");
  else if (tem.test(cab)) cab = cab.replace(tem, linha);
  else {
    const linhas = cab.split("\n");
    let ult = 0;
    linhas.forEach((l, i) => { if (/^[a-z_]+:/.test(l)) ult = i; });
    linhas.splice(ult + 1, 0, linha);
    cab = linhas.join("\n");
  }
  return cab + resto;
}

/** Estado de publicação de uma seção (vale `publicacao:` ou o `status:` antigo). */

/** data + hora locais da nota → ISO. Sem hora, meio-dia (só o dia importa). */
export function agendadoDe(c: Campos): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.data ?? "")) return null;
  const h = /^\d{1,2}:\d{2}$/.test(c.hora ?? "") ? c.hora.padStart(5, "0") : "12:00";
  const d = new Date(`${c.data}T${h}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const diaLocal = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const horaLocal = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoLocal = (d = new Date()) => {
  const off = -d.getTimezoneOffset(), s = off >= 0 ? "+" : "-";
  return `${diaLocal(d)}T${horaLocal(d)}:${pad(d.getSeconds())}${s}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
};

export type PostTipo = "video" | "carrossel" | "proprio";
export interface PostVault {
  id: string; perfil: PerfilVault; secao: Secao; tipo: PostTipo;
  ref: string | null; personagem: string | null; replicacao: string | null; versao: string | null; canal: string | null;
  titulo: string; data: string | null; hora: string | null; agendado_para: string | null;
  publicacao: Publicacao; url: string | null; postado_em: string | null; arquivado_em: string | null; registrado_em: string | null;
}

function personagemDo(perfil: PerfilVault, c: Campos, titulo: string, ref: string | null, root?: string): string | null {
  const ps = perfil.personagens;
  if (ps.length <= 1) return ps[0]?.slug ?? null;
  const p = c.personagem ? ps.find((x) => x.slug === c.personagem || slugify(x.name) === slugify(c.personagem) || x.slug.endsWith(`-${slugify(c.personagem)}`)) : null;
  if (p) return p.slug;
  const pista = slugify(`${basename(c.video ?? "")} ${titulo}`);
  const porPista = ps.find((x) => pista.includes(x.slug.split("-").pop()!));
  if (porPista) return porPista.slug;
  if (ref && root) { const com = ps.filter((x) => existsSync(join(root, "replicacoes", ref, x.slug))); if (com.length === 1) return com[0].slug; }
  return null;
}

const tituloCurto = (t: string) => (/\s[—–]\s/.test(t) ? t.split(/\s+[—–]\s+/).slice(1).join(" — ") : t).trim();

function montar(perfil: PerfilVault, s: Secao, root?: string): PostVault {
  const c = s.c;
  const tipoNota = (c.tipo ?? "").toLowerCase();
  const ref = /^REF-\d{4}-\d{2}-\d{4}$/.test(c.ref ?? "") ? c.ref : null;
  const tipo: PostTipo = tipoNota === "carrossel" ? "carrossel" : ref ? "video" : "proprio";
  const personagem = tipo === "carrossel" ? null : personagemDo(perfil, c, s.titulo, ref, root);
  return {
    id: c.id || slugify(`${perfil.slug}-${s.titulo}`).slice(0, 90), perfil, secao: s, tipo, ref, personagem,
    replicacao: ref && personagem ? `${ref}--${personagem}` : null,
    versao: /^V\d+$/i.test(c.versao ?? "") ? c.versao.toUpperCase() : tipo === "video" ? "V1" : null,
    canal: c.canal || null, titulo: tituloCurto(s.titulo), data: c.data || null, hora: c.hora || null, agendado_para: agendadoDe(c),
    publicacao: publicacaoDe(c), url: (c.url ?? "").trim() || null, postado_em: c.postado_em || null, arquivado_em: c.arquivado_em || null,
    registrado_em: c.registrado_em || null,
  };
}

/** Todos os posts das notas dos perfis do vault (sem produção nem mídia: barato, usado também pelo sync do pipeline). */
export function lerPostsVault(root?: string, perfilSlug?: string | null): PostVault[] {
  const out: PostVault[] = [];
  for (const p of perfisVault()) {
    if (perfilSlug && p.slug !== perfilSlug && !p.personagens.some((c) => c.slug === perfilSlug)) continue;
    for (const s of secoes(ler(notaDe(p)))) if (ehPost(s)) out.push(montar(p, s, root));
  }
  return out;
}

/** O personagem tem nota de postagens no vault? Então a publicação dele é gerida pelos posts (nunca pelo flow-producao.json). */
export function geridoPelaNota(slug: string): boolean {
  const p = perfisVault().find((x) => x.personagens.some((c) => c.slug === slug));
  return !!p && existsSync(notaDe(p));
}

// ---------------------------------------------------------------- resumo por replicação (o pipeline usa)

export type ResumoPosts = { total: number; postados: number; abertos: number; arquivados: number; post_url: string | null; postado_em: string | null; agendado_para: string | null };

export function resumoPorReplicacao(posts: PostVault[]): Map<string, ResumoPosts> {
  const m = new Map<string, ResumoPosts>();
  for (const p of posts) {
    if (p.tipo !== "video" || !p.replicacao) continue;
    const r = m.get(p.replicacao) ?? { total: 0, postados: 0, abertos: 0, arquivados: 0, post_url: null, postado_em: null, agendado_para: null };
    r.total++;
    if (p.publicacao === "arquivado") r.arquivados++;
    else if (p.publicacao === "postado") {
      r.postados++;
      if (!r.postado_em || (p.postado_em && p.postado_em > r.postado_em)) { r.postado_em = p.postado_em ?? r.postado_em; r.post_url = p.url ?? r.post_url; }
      else if (!r.post_url && p.url) r.post_url = p.url;
    } else {
      r.abertos++;
      if (p.agendado_para && (!r.agendado_para || p.agendado_para < r.agendado_para)) r.agendado_para = p.agendado_para;
    }
    m.set(p.replicacao, r);
  }
  return m;
}

// ---------------------------------------------------------------- lista completa (Home, calendário, estúdio, painel)

export type PostStage = "producao" | "pronta" | "agendada" | "postada" | "arquivada";
export type LegendaFonte = "nota" | "adaptada" | "carrossel" | "referencia";
export interface PostItem {
  id: string; perfil: { slug: string; name: string; handle: string | null }; personagem: string | null; personagem_nome: string | null;
  tipo: PostTipo; ref: string | null; replicacao: string | null; versao: string | null; canal: string | null;
  titulo: string; secao: string; data: string | null; hora: string | null; agendado_para: string | null;
  stage: PostStage; late: boolean; publicacao: Publicacao; post_url: string | null; postado_em: string | null; arquivado_em: string | null;
  legenda: string | null; legenda_fonte: LegendaFonte | null; versoes: string[];
  video: string | null; slides: string[]; capa: string | null; hub_url: string | null;
  /** Miniatura da referência (caminho da biblioteca) para grades pequenas, como o calendário. */
  ref_thumb: string | null;
}
export type RepResumo = { id: string; etapa: string; editado?: string | null };

const blocoLegenda = (t: string) => t.match(/```legenda\n([\s\S]*?)```/)?.[1].trim() || null;
function legendaPostsMd(perfil: PerfilVault, de: string): string | null {
  const num = de.match(/^Posts\.md#(\w+)/)?.[1];
  if (!num) return null;
  const sec = secoes(ler(join(perfil.pasta, "06_roadmap", "Posts.md"))).find((s) => s.titulo.split(/\s/)[0] === num);
  return sec ? blocoLegenda(sec.texto) : null;
}
const legendasJson = (root: string, rep: string | null) => {
  if (!rep) return null;
  const [ref, slug] = rep.split("--");
  try { return JSON.parse(readFileSync(join(root, "replicacoes", ref, slug, "legendas-post.json"), "utf8")); } catch { return null; }
};

/** Legenda do post: a da seção (bloco ou Posts.md#NN) → a versão dele no legendas-post.json → a da referência com o perfil trocado. */
export function legendaDoPost(db: Database | null, root: string, p: PostVault, carrosselLegenda?: string | null): { texto: string; fonte: LegendaFonte } | null {
  const propria = blocoLegenda(p.secao.texto) ?? (p.secao.c.legenda_de ? legendaPostsMd(p.perfil, p.secao.c.legenda_de) : null);
  if (propria) return { texto: propria, fonte: "nota" };
  if (p.tipo === "carrossel") return carrosselLegenda ? { texto: carrosselLegenda, fonte: "carrossel" } : null;
  const j = legendasJson(root, p.replicacao);
  const v = j?.versoes?.find((x: any) => String(x.id).toUpperCase() === (p.versao ?? "V1")) ?? (p.versao === "V1" ? j?.versoes?.[0] : null);
  if (v?.texto) return { texto: v.texto, fonte: "adaptada" };
  if (!p.ref || !db) return null;
  let r: any = null;
  try { r = db.query("SELECT caption, username FROM refs WHERE id = ?").get(p.ref); } catch { r = null; }
  return r?.caption ? { texto: trocarPerfil(r.caption, r.username, p.personagem ? handleDoPersonagem(root, p.personagem) : null), fonte: "referencia" } : null;
}

function handleDoPerfil(root: string, perfil: PerfilVault): string | null {
  const fm = ler(notaDe(perfil)).match(/^---\n([\s\S]*?)\n---/)?.[1]?.match(/^perfil: *["']?@?([\w.]+)/m)?.[1];
  return fm ?? (perfil.personagens[0] ? handleDoPersonagem(root, perfil.personagens[0].slug) : null);
}

/** Vídeo próprio (sem REF): arquivo do campo `video:`, só dentro da pasta do perfil ou da biblioteca de projetos. */
export function arquivoVideoProprio(id: string): string | null {
  const p = lerPostsVault().find((x) => x.id === id);
  return p ? videoProprioDe(p) : null;
}
function videoProprioDe(p: PostVault): string | null {
  const v = p.secao.c.video;
  if (!v) return null;
  const abs = isAbsolute(v) ? v : join(p.perfil.pasta, v);
  if (!existsSync(abs) || !/\.(mp4|mov|m4v|webm)$/i.test(abs)) return null;
  const real = realpathSync(abs);
  return dentro(realpathSync(p.perfil.pasta), real) ? real : null;
}

export function listarPosts(db: Database, root: string, reps: RepResumo[], opts: { profile?: string | null; hoje?: string } = {}): PostItem[] { return lerUmaVez(() => montarPosts(db, root, reps, opts)); }
function montarPosts(db: Database, root: string, reps: RepResumo[], opts: { profile?: string | null; hoje?: string }): PostItem[] {
  const hoje = opts.hoje ?? diaLocal(new Date());
  const porRep = new Map(reps.map((r) => [r.id, r]));
  const carrosseis = listarCarrosseis(opts.profile ?? null);
  const handles = new Map<string, string | null>();
  const thumb = (ref: string | null) => { if (!ref) return null; try { return (db.query("SELECT thumb_path FROM refs WHERE id = ?").get(ref) as any)?.thumb_path ?? null; } catch { return null; } };
  return lerPostsVault(root, opts.profile).map((p): PostItem => {
    if (!handles.has(p.perfil.slug)) handles.set(p.perfil.slug, handleDoPerfil(root, p.perfil));
    const car = p.tipo === "carrossel" ? carrosseis.find((x) => x.perfil.slug === p.perfil.slug && (x.postagem_id === p.secao.c.id || x.rel === (p.secao.c.pasta ?? "").replace(/\/+$/, ""))) ?? null : null;
    const rep = p.replicacao ? porRep.get(p.replicacao) : undefined;
    const final = p.tipo === "video" && p.ref && p.personagem ? videoFinalVault(p.ref, p.personagem) : null;
    const video = p.tipo === "video" ? (rep?.editado ?? (final && p.replicacao ? `/api/replicacoes/${p.replicacao}/producao/editado` : null))
      : p.tipo === "proprio" && videoProprioDe(p) ? `/api/posts/${encodeURIComponent(p.id)}/video` : null;
    const pronto = p.tipo === "carrossel" ? !!car && (car.etapa === "pronto" || car.etapa === "postado")
      : p.tipo === "video" ? !!video || ["pronto", "postado"].includes(rep?.etapa ?? "") : !!video;
    const dia = p.agendado_para ? diaLocal(new Date(p.agendado_para)) : null;
    const stage: PostStage = p.publicacao === "arquivado" ? "arquivada" : p.publicacao === "postado" ? "postada"
      : !pronto ? "producao" : dia && dia >= hoje ? "agendada" : "pronta";
    const leg = legendaDoPost(db, root, p, car?.legenda);
    const pers = p.personagem ? p.perfil.personagens.find((c) => c.slug === p.personagem) : null;
    return {
      id: p.id, perfil: { slug: p.perfil.slug, name: p.perfil.name, handle: handles.get(p.perfil.slug) ?? null },
      personagem: p.personagem, personagem_nome: p.perfil.personagens.length > 1 && pers ? pers.name : null,
      tipo: p.tipo, ref: p.ref, replicacao: p.replicacao, versao: p.versao, canal: p.canal,
      titulo: p.titulo, secao: p.secao.titulo, data: p.data, hora: p.hora, agendado_para: p.agendado_para,
      stage, late: stage !== "postada" && stage !== "arquivada" && !!dia && dia < hoje,
      publicacao: p.publicacao, post_url: p.url, postado_em: p.postado_em, arquivado_em: p.arquivado_em,
      legenda: leg?.texto ?? null, legenda_fonte: leg?.fonte ?? null,
      versoes: (legendasJson(root, p.replicacao)?.versoes ?? []).map((v: any) => String(v.id)),
      video, slides: car ? car.slides.map((s) => s.replicado ?? s.original).filter((x): x is string => !!x) : [],
      capa: car?.capa ?? null,
      hub_url: p.tipo === "carrossel" ? (car ? `/carrossel/${car.id}` : null) : p.replicacao ? `/producao/${p.replicacao}/publicacao?post=${encodeURIComponent(p.id)}` : null,
      ref_thumb: thumb(p.ref),
    };
  });
}

// ---------------------------------------------------------------- escrita (só a seção do post muda)

function gravarNota(arq: string, texto: string) {
  const tmp = `${arq}.hub-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, texto);
  renameSync(tmp, arq);
}

function editarSecao(id: string, fn: (sec: string, p: PostVault) => string): PostVault {
  const p = lerPostsVault().find((x) => x.id === id);
  if (!p) throw new HttpError(404, `Post não encontrado na nota: ${id}`);
  const arq = notaDe(p.perfil), t = ler(arq);
  const s = secoes(t).find((x) => ehPost(x) && (x.c.id || slugify(`${p.perfil.slug}-${x.titulo}`).slice(0, 90)) === id);
  if (!s) throw new HttpError(409, "A nota mudou durante a gravação; tente de novo.");
  gravarNota(arq, t.slice(0, s.ini) + fn(s.texto, p) + t.slice(s.fim));
  return lerPostsVault().find((x) => x.id === id)!;
}

/** `auto`: data escolhida pela agenda automática (grava `agenda: auto` e, se remarcou, `remarcado_de`). Sem `auto`, agendar tira as marcas. */
export type PostPatch = { publicacao?: Publicacao; url?: string | null; postado_em?: string | null; agendado_para?: string | null; canal?: string | null; auto?: { de: string | null } };

function validarIso(v: unknown, nome: string): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${nome} inválido`);
  return v;
}

/** Muda um post: publicar/desmarcar/arquivar, link, data real, agenda e canal. Só os campos enviados mudam. */
/** Roda os lembretes uma vez, logo depois de marcar ou mudar a data de um post. Não há rotina periódica. */
let lembretesTimer: ReturnType<typeof setTimeout> | null = null;
function atualizarLembretes() {
  if (process.env.NODE_ENV === "test" || process.platform !== "darwin") return;
  if (lembretesTimer) clearTimeout(lembretesTimer);
  lembretesTimer = setTimeout(() => {
    lembretesTimer = null;
    Bun.spawn(["/opt/homebrew/bin/python3", join(import.meta.dir, "../scripts/lembretes-postagens.py")], { stdout: "ignore", stderr: "ignore" });
  }, 2000);
}

export function atualizarPost(id: string, b: PostPatch): PostVault {
  const r = gravarPost(id, b);
  if (b.publicacao !== undefined || b.agendado_para !== undefined) atualizarLembretes();
  return r;
}

function gravarPost(id: string, b: PostPatch): PostVault {
  if (b.publicacao !== undefined && !["a_publicar", "postado", "arquivado"].includes(b.publicacao)) throw new HttpError(400, "publicacao inválida");
  const url = b.url === undefined ? undefined : normalizePostUrl(String(b.url ?? ""));
  if (url && !/^https:\/\/(www\.)?(instagram\.com|tiktok\.com|youtube\.com|youtu\.be)\//.test(url)) throw new HttpError(400, "Link do post inválido");
  const postadoEm = b.postado_em === undefined ? undefined : validarIso(b.postado_em, "postado_em");
  const agendado = b.agendado_para === undefined ? undefined : validarIso(b.agendado_para, "agendado_para");
  return editarSecao(id, (sec, p) => {
    const campoSt = "publicacao" in p.secao.c || !("status" in p.secao.c) ? "publicacao" : "status";
    const rotulo = (v: Publicacao) => campoSt === "status" ? ({ a_publicar: "a postar", postado: "postado", arquivado: "arquivado" } as const)[v] : v;
    if (b.publicacao !== undefined) {
      sec = comCampo(sec, campoSt, rotulo(b.publicacao));
      if (b.publicacao === "arquivado") sec = comCampo(sec, "arquivado_em", isoLocal());
      else sec = comCampo(sec, "arquivado_em", null);
      if (b.publicacao === "a_publicar") { sec = comCampo(sec, "url", p.secao.c.url !== undefined ? "" : null); sec = comCampo(sec, "postado_em", null); sec = comCampo(sec, "registrado_em", null); }
      // Quando foi marcado aqui (≠ data real do post): desempata "desfazer o último marcado".
      if (b.publicacao === "postado" && p.publicacao !== "postado") sec = comCampo(sec, "registrado_em", isoLocal());
    }
    if (url !== undefined) sec = comCampo(sec, "url", url || (p.secao.c.url !== undefined ? "" : null));
    if (postadoEm !== undefined) sec = comCampo(sec, "postado_em", postadoEm);
    if (agendado !== undefined) {
      const d = agendado ? new Date(agendado) : null;
      sec = comCampo(sec, "data", d ? diaLocal(d) : "");
      sec = comCampo(sec, "hora", d ? horaLocal(d) : null);
      if (b.auto) {
        sec = comCampo(sec, "agenda", "auto");
        if (b.auto.de) { const v = new Date(b.auto.de); sec = comCampo(sec, "remarcado_de", `${diaLocal(v)} ${horaLocal(v)}`); }
      } else {
        sec = comCampo(sec, "agenda", null);
        sec = comCampo(sec, "remarcado_de", null);
      }
    }
    if (b.canal !== undefined) sec = comCampo(sec, "canal", b.canal?.trim() || null);
    return sec;
  });
}

/** Cria um post novo (variação) de uma replicação, logo depois dos posts dela na nota. */
export function criarPost(db: Database, root: string, repId: string, b: { versao?: string; canal?: string | null; agendado_para?: string | null }): PostVault {
  const [ref, slug] = repId.split("--");
  if (!ref || !slug) throw new HttpError(400, "Post é por REF × personagem (use <REF>--<slug>)");
  const perfil = perfisVault().find((x) => x.personagens.some((c) => c.slug === slug));
  if (!perfil) throw new HttpError(400, "Esse personagem não tem pasta de perfil no vault");
  const arq = notaDe(perfil);
  if (!existsSync(arq)) throw new HttpError(400, "O perfil não tem 06_roadmap/Postagens.md");
  const versao = (b.versao ?? "V1").toUpperCase();
  if (!/^V\d+$/.test(versao)) throw new HttpError(400, "versao inválida (V1, V2…)");
  const agendado = b.agendado_para ? new Date(validarIso(b.agendado_para, "agendado_para")!) : null;
  const t = ler(arq), ss = secoes(t);
  const todos = lerPostsVault(root, perfil.slug);
  const irmaos = todos.filter((p) => p.replicacao === repId);
  const base = irmaos[0];
  const ids = new Set(todos.map((p) => p.id));
  const num = ref.slice(-4);
  let id = base ? `${base.id.replace(/-v\d+(-.*)?$/i, "")}-${versao.toLowerCase()}` : `${slugify(perfil.slug).split("-")[0]}-ref${num}${perfil.personagens.length > 1 ? `-${slug.split("-").pop()}` : ""}${versao === "V1" ? "" : `-${versao.toLowerCase()}`}`;
  for (let n = 2; ids.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
  let refTitulo = base?.titulo.replace(/\s+·\s+V\d+.*$/i, "") ?? "";
  if (!refTitulo) {
    let cap: any = null;
    try { cap = db.query("SELECT caption FROM refs WHERE id = ?").get(ref); } catch { cap = null; }
    refTitulo = String(cap?.caption ?? "").split("\n")[0].replace(/[^\p{L}\p{N}\s,.!?-]/gu, "").trim().slice(0, 60) || ref;
  }
  const video = base?.secao.c.video ?? (() => { const f = videoFinalVault(ref, slug); return f ? relative(perfil.pasta, f) : null; })();
  const linhas = [
    `## Vídeo ${ref} — ${refTitulo} · ${versao}${b.canal ? ` · ${b.canal}` : ""}`,
    `id: ${id}`, "tipo: video", `ref: ${ref}`,
    ...(perfil.personagens.length > 1 ? [`personagem: ${slug.split("-").pop()}`] : []),
    `versao: ${versao}`, ...(b.canal ? [`canal: ${b.canal}`] : []),
    ...(video ? [`video: ${video}`] : []),
    `data: ${agendado ? diaLocal(agendado) : ""}`, ...(agendado ? [`hora: ${horaLocal(agendado)}`] : []),
    "publicacao: a_publicar", "url:", "", "",
  ].join("\n");
  const depois = irmaos.length ? Math.max(...irmaos.map((p) => ss.find((s) => s.titulo === p.secao.titulo)?.fim ?? 0))
    : (ss.filter(ehPost).at(-1)?.fim ?? t.length);
  const antes = t.slice(0, depois);
  gravarNota(arq, antes + (antes.endsWith("\n\n") || !antes ? "" : antes.endsWith("\n") ? "\n" : "\n\n") + linhas + t.slice(depois));
  return lerPostsVault(root, perfil.slug).find((p) => p.id === id)!;
}

// ---------------------------------------------------------------- ações por replicação (botões antigos, postei.py)

const ordemAbertos = (a: PostVault, b: PostVault) => (a.agendado_para ?? "9999").localeCompare(b.agendado_para ?? "9999") || (a.versao ?? "").localeCompare(b.versao ?? "", "pt-BR", { numeric: true });

export function postsDaReplicacao(root: string, repId: string): PostVault[] {
  return lerPostsVault(root).filter((p) => p.replicacao === repId);
}

/** Post alvo de uma ação feita na replicação: o pedido (`post`), senão o próximo em aberto, senão um novo. */
export function alvoDaReplicacao(db: Database, root: string, repId: string, post: string | undefined, quer: "aberto" | "postado" | "arquivado"): PostVault | null {
  const ps = postsDaReplicacao(root, repId);
  if (post) { const p = ps.find((x) => x.id === post); if (!p) throw new HttpError(404, `Post ${post} não é desta replicação`); return p; }
  if (quer === "postado") return ps.filter((p) => p.publicacao === "postado").sort((a, b) => (b.registrado_em ?? b.postado_em ?? "").localeCompare(a.registrado_em ?? a.postado_em ?? ""))[0] ?? null;
  if (quer === "arquivado") return ps.find((p) => p.publicacao === "arquivado") ?? null;
  const aberto = ps.filter((p) => p.publicacao === "a_publicar").sort(ordemAbertos)[0];
  if (aberto) return aberto;
  const versoes: string[] = (legendasJson(root, repId)?.versoes ?? []).map((v: any) => String(v.id).toUpperCase());
  const usadas = new Set(ps.map((p) => p.versao));
  return criarPost(db, root, repId, { versao: versoes.find((v) => !usadas.has(v)) ?? "V1" });
}
