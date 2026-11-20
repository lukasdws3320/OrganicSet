import { expertSlug } from "../../server/text";
import type { Profile, ProfileTipo } from "../../server/types";

type Expert = { id: number; name: string };
type Replication = { slug?: string | null; expert?: string | null };

/** Cadastro completo, com os vínculos históricos das produções preservados. */
export function productionExperts(catalog: Expert[], replications: Replication[]) {
  const experts = catalog.map(e => {
    const own = replications.filter(r => r.slug && r.expert === e.name);
    return { ...e, slug: own[0]?.slug || expertSlug(e.name), replications: own.length };
  });
  for (const r of replications) {
    if (r.slug && r.expert && !experts.some(e => e.slug === r.slug)) {
      experts.push({ id: 0, name: r.expert, slug: r.slug, replications: replications.filter(x => x.slug === r.slug).length });
    }
  }
  return experts;
}

// ---------- perfis (SPEC §5.2 Experts: o perfil agrupa personagens) ----------

export const TIPO_LABEL: Record<ProfileTipo, string> = {
  cliente_aw: "Cliente AW",
  expert_parceiro: "Expert parceiro",
  operacao_propria_dr: "Operação própria DR",
};

/** Perfil por slug canônico, alias ou slug de personagem (ex.: bruno-goytacazes → bruno-goytacaz). */
export function findProfile(profiles: Profile[] | null | undefined, slug: string | null | undefined) {
  if (!profiles || !slug) return undefined;
  const s = slug.toLowerCase();
  return profiles.find(p => p.slug === s)
    ?? profiles.find(p => p.aliases.includes(s) || p.personagens.some(c => c.slug === s));
}

/** Perfil dono de um personagem (clients.id). */
export const profileOfClient = (profiles: Profile[] | null | undefined, clientId: number) =>
  profiles?.find(p => p.personagens.some(c => c.id === clientId));

/** Nome curto do personagem dentro do perfil: "Mini Chefs da Vovó Loira" → "Loira". */
export function personagemCurto(profileName: string, name: string) {
  const norm = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (norm(name).startsWith(norm(profileName) + " ")) return name.slice(profileName.length).trim() || name;
  return name;
}

// ---------- rotas (transição: App.tsx atual × navegação nova do H4) ----------

export const ESTUDIO_ABAS = ["referencia", "shots", "edicao", "publicacao"] as const;
export type EstudioAba = (typeof ESTUDIO_ABAS)[number];
export const PRODUCAO_VISOES = ["quadro", "lista", "calendario"] as const;
export type ProducaoVisao = (typeof PRODUCAO_VISOES)[number];
export const EXPERT_ABAS = ["visao", "producao", "postagens", "referencias", "identidade"] as const;
export type ExpertAba = (typeof EXPERT_ABAS)[number];

const LEGADO_ABA: Record<string, EstudioAba> = { scenes: "referencia", production: "shots", producao: "shots", edit: "edicao" };
export function estudioAba(v: string | null | undefined): EstudioAba {
  const x = (v ?? "").toLowerCase();
  return (ESTUDIO_ABAS as readonly string[]).includes(x) ? (x as EstudioAba) : LEGADO_ABA[x] ?? "referencia";
}
export const producaoVisao = (v: string | null | undefined): ProducaoVisao =>
  (PRODUCAO_VISOES as readonly string[]).includes(v ?? "") ? (v as ProducaoVisao) : "quadro";
export const expertAba = (v: string | null | undefined): ExpertAba =>
  (EXPERT_ABAS as readonly string[]).includes(v ?? "") ? (v as ExpertAba) : "visao";

/**
 * `v2 = true` quando o App usa as rotas novas (/producao?expert=, /producao/:id/:aba, /experts/:slug/:aba).
 * O H4 liga com `rotas.v2 = true` ao trocar o App.tsx. Até lá, os links continuam nas rotas que o App atual
 * reconhece (/replicacao/:id?aba=, /producao/:slug, /experts/:id?aba=), e recarregar mantém a aba.
 */
export const rotas = { v2: false };
const pathAtual = () => (typeof location === "undefined" ? "" : location.pathname);
export function rotasNovas(path = pathAtual()) {
  return rotas.v2 || path === "/producao" || /^\/producao\/[^/]+--[^/]+/.test(path) || /^\/experts\/[^/]*[^\d/][^/]*(\/|$)/.test(path);
}
const qs = (o: Record<string, string | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) u.set(k, v);
  const t = u.toString();
  return t ? `?${t}` : "";
};

export function estudioHref(id: string, aba: EstudioAba = "referencia", v2 = rotasNovas()) {
  return v2 ? `/producao/${id}/${aba}` : `/replicacao/${id}${aba === "referencia" ? "" : qs({ aba })}`;
}
export function producaoHref(expert?: string | null, visao?: ProducaoVisao | null, v2 = rotasNovas()) {
  const vz = visao && visao !== "quadro" ? visao : null;
  if (v2) return `/producao${qs({ expert, visao: vz })}`;
  return expert ? `/producao/${expert}${qs({ visao: vz })}` : `/replicacao${qs({ visao: vz })}`;
}
/** Página do perfil. No App atual a rota é numérica (/experts/<id do personagem>). */
export function expertHref(p: { slug: string; personagens: { id: number }[] }, aba: ExpertAba = "visao", v2 = rotasNovas()) {
  if (v2) return `/experts/${p.slug}${aba === "visao" ? "" : `/${aba}`}`;
  return `/experts/${p.personagens[0]?.id ?? p.slug}${aba === "visao" ? "" : qs({ aba })}`;
}

/** Corpo do 404 de slug desconhecido (H1): {codigo:'expert_nao_encontrado', slug, sugestao}. */
export type ExpertNaoEncontrado = { codigo: "expert_nao_encontrado"; slug: string; sugestao: { slug: string; name: string } | null };
export const isExpertNaoEncontrado = (d: unknown): d is ExpertNaoEncontrado =>
  !!d && typeof d === "object" && (d as { codigo?: string }).codigo === "expert_nao_encontrado";

/** Sugestão local para slug desconhecido (mesma ideia do 404 do Hub): maior prefixo comum com slug, alias ou personagem. */
export function sugerirPerfil(profiles: Profile[] | null | undefined, slug: string): ExpertNaoEncontrado["sugestao"] {
  if (!profiles?.length || !slug) return null;
  const s = slug.toLowerCase();
  let best: { p: Profile; n: number } | null = null;
  for (const p of profiles) {
    for (const k of [p.slug, ...p.aliases, ...p.personagens.map((c) => c.slug)]) {
      let n = 0;
      while (n < k.length && n < s.length && k[n] === s[n]) n++;
      if (k.includes(s) || s.includes(k)) n = Math.max(n, Math.min(k.length, s.length));
      if (!best || n > best.n) best = { p, n };
    }
  }
  return best && best.n >= 5 ? { slug: best.p.slug, name: best.p.name } : null;
}
