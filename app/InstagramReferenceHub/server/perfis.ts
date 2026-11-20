import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpError } from "./refs";

/**
 * Perfis do Instagram analisados (aba /perfis).
 *
 * `library/perfis/<handle>/perfil.json` (schema irh-perfil/v1) vem pronto do
 * AnaliseInstagram (`exportar_hub.py`): números, ranking, roteiro e leitura dos
 * comentários de cada post. O Hub só lê esse arquivo.
 * `library/perfis/estado.json` é do Matheus: para que o perfil serve
 * (inspiração / análise / referência), nota e perfis adicionados que ainda
 * não foram analisados.
 */

export const USOS = ["inspiracao", "analise", "referencia"] as const;
export type Uso = (typeof USOS)[number];
type Estado = Record<string, { usos?: Uso[]; nota?: string; adicionado_em?: string }>;

// Regra do Instagram: letras, números, "." e "_"; sem ponto no início/fim nem "..".
const HANDLE = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;
const dir = (root: string) => join(root, "perfis");
const estadoPath = (root: string) => join(dir(root), "estado.json");

export function normalizarHandle(v: unknown): string {
  const h = String(v ?? "").trim().toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (!HANDLE.test(h)) throw new HttpError(400, "Perfil inválido: use @usuario ou o link do Instagram");
  return h;
}

function lerEstado(root: string): Estado {
  try { return JSON.parse(readFileSync(estadoPath(root), "utf8")); } catch { return {}; }
}
function gravarEstado(root: string, e: Estado) {
  mkdirSync(dir(root), { recursive: true });
  writeFileSync(estadoPath(root), JSON.stringify(e, null, 2), "utf8");
}
function lerPerfil(root: string, h: string): any | null {
  const p = join(dir(root), h, "perfil.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/** Resumo pra lista: o suficiente pro cartão, sem os posts. */
function resumo(h: string, p: any | null, e: Estado[string] = {}) {
  const posts = p ? Object.values(p.posts ?? {}) as any[] : [];
  const capa = p ? (p.ranking?.views ?? []).concat(p.ranking?.curtidas ?? []).map((c: string) => p.posts[c]?.capa).find(Boolean) ?? null : null;
  return {
    handle: h, url: `https://www.instagram.com/${h}/`, nome: p?.nome ?? null, quem: p?.quem ?? null,
    analisado: !!p, coletado_em: p?.coletado_em ?? null, recorte: p?.recorte ?? null,
    metricas: p?.metricas ?? null, posts: posts.length, capa,
    objetivo_top: p?.leitura_posts?.objetivos?.[0] ?? null, hook_med_s: p?.leitura_posts?.hook_med_s ?? null,
    lidos: p?.leitura_posts?.lidos ?? 0, audiencia: !!p?.audiencia,
    usos: e.usos ?? [], nota: e.nota ?? "", adicionado_em: e.adicionado_em ?? null,
  };
}

export function listarPerfis(root: string) {
  const e = lerEstado(root);
  const prontos = existsSync(dir(root))
    ? readdirSync(dir(root), { withFileTypes: true }).filter((d) => d.isDirectory() && HANDLE.test(d.name)).map((d) => d.name)
    : [];
  const hs = [...new Set([...prontos, ...Object.keys(e)])];
  return hs.map((h) => resumo(h, lerPerfil(root, h), e[h]))
    .sort((a, b) => Number(b.analisado) - Number(a.analisado) || (b.metricas?.med_views ?? 0) - (a.metricas?.med_views ?? 0));
}

export function obterPerfil(root: string, handle: string) {
  const h = normalizarHandle(handle);
  const p = lerPerfil(root, h);
  const e = lerEstado(root)[h];
  if (!p && !e) throw new HttpError(404, "Perfil não encontrado");
  return { ...resumo(h, p, e), dados: p };
}

export function adicionarPerfil(root: string, b: any) {
  const h = normalizarHandle(b?.handle);
  const e = lerEstado(root);
  e[h] = { ...e[h], usos: limparUsos(b?.usos) ?? e[h]?.usos ?? [], nota: String(b?.nota ?? e[h]?.nota ?? "").slice(0, 2000), adicionado_em: e[h]?.adicionado_em ?? new Date().toISOString() };
  gravarEstado(root, e);
  return obterPerfil(root, h);
}

export function atualizarPerfil(root: string, handle: string, b: any) {
  const h = normalizarHandle(handle);
  const e = lerEstado(root);
  if (!e[h] && !lerPerfil(root, h)) throw new HttpError(404, "Perfil não encontrado");
  const cur = e[h] ?? {};
  e[h] = { ...cur, ...(b?.usos !== undefined ? { usos: limparUsos(b.usos) ?? [] } : {}), ...(b?.nota !== undefined ? { nota: String(b.nota).slice(0, 2000) } : {}) };
  gravarEstado(root, e);
  return obterPerfil(root, h);
}

/** Ficha de um post (legenda inteira, fala com tempo, comentários): `posts/<code>.json`, gravado pelo perfil_hub.py. */
export function fichaPost(root: string, handle: string, code: string) {
  const h = normalizarHandle(handle);
  if (!/^[\w-]{1,40}$/.test(code)) throw new HttpError(400, "Post inválido");
  const p = lerPerfil(root, h);
  if (!p?.posts?.[code]) throw new HttpError(404, "Post não está na análise deste perfil");
  let extra: any = null;
  try { extra = JSON.parse(readFileSync(join(dir(root), h, "posts", `${code}.json`), "utf8")); } catch { extra = null; }
  return { ...p.posts[code], ficha: extra };
}

/** Tira só o perfil adicionado à mão; perfil analisado fica (o arquivo é do AnaliseInstagram). */
export function removerPerfil(root: string, handle: string) {
  const h = normalizarHandle(handle);
  if (lerPerfil(root, h)) throw new HttpError(409, "Perfil analisado: remova a pasta library/perfis/" + h + " se quiser tirá-lo");
  const e = lerEstado(root);
  delete e[h];
  gravarEstado(root, e);
  return { ok: true };
}

function limparUsos(v: unknown): Uso[] | null {
  if (!Array.isArray(v)) return null;
  return USOS.filter((u) => v.includes(u));
}
