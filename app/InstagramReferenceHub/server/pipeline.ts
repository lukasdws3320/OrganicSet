// Ciclo único da referência (SPEC §3.2): um estado por coisa, calculado, nunca digitado.
//
//   library/replicacoes/<REF>/<slug>/   continua sendo a FONTE (etapa vem dos arquivos: replicacao.json, clipes, editado, postUrl)
//   ref_pipeline                         é o ESPELHO materializado por REF × personagem (clients), com histórico em ref_pipeline_events
//   agendado_para                        é o único dado que nasce aqui (PATCH /api/pipeline/:id), vindo da agenda do painel
//
// Perfil (profiles) = conta/negócio; personagem (clients) = avatar. O slug do perfil, o do personagem e os aliases resolvem para o mesmo lugar.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { now, profileAtivo } from "./db";
import { HttpError, type Ctx } from "./refs";
import { listReplicacoes, resolveReplicacaoId } from "./replicacoes";
import { expertSlug } from "./text";
import { legendaDoPost as legendaLegada } from "./perfis-vault";
import { alvoDaReplicacao, atualizarPost, geridoPelaNota, legendaDoPost, lerPostsVault, resumoPorReplicacao } from "./posts";
import {
  ETAPA_LABEL, STAGES,
  type Etapa, type Funnel, type PipelineEvent, type PipelineItem, type PipelineResponse, type Profile, type PublicPipelineResponse,
  type PublicStage, type RefPipeline, type Stage, type StageCounts,
} from "./types";

// ---------- datas (dia local, para "agendada" × "atrasada") ----------

const TZ = process.env.IRH_TZ || "America/Sao_Paulo";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const SHORT_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const TIME_FMT = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia local (AAAA-MM-DD) de uma data ISO. Data pura ("2026-10-27") é tratada como dia local, sem fuso. */
export function localDay(d: Date | string = new Date()): string {
  if (typeof d === "string" && DATE_ONLY.test(d)) return d;
  return DAY_FMT.format(typeof d === "string" ? new Date(d) : d);
}

/** "27/10" ou "27/10 17:30" (só com hora quando o valor tem hora). */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  if (DATE_ONLY.test(iso)) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : SHORT_FMT.format(d);
}
function shortDateTime(iso: string | null): string {
  if (!iso) return "";
  if (DATE_ONLY.test(iso)) return shortDate(iso);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${SHORT_FMT.format(d)} ${TIME_FMT.format(d)}`;
}

/** Aceita data (AAAA-MM-DD) ou data-hora ISO 8601. Devolve o valor como veio (sem normalizar o fuso). */
export function parseIsoInput(v: unknown, label: string): string | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new HttpError(400, `${label}: use uma data ISO (AAAA-MM-DD ou AAAA-MM-DDTHH:MM±HH:MM)`);
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new HttpError(400, `${label}: data inválida (${s.slice(0, 40)})`);
  }
  return s;
}

// ---------- ciclo (puro) ----------

export const STAGE_RANK: Record<Stage, number> = Object.fromEntries(STAGES.map((s, i) => [s, i])) as Record<Stage, number>;
const PRODUCAO: readonly string[] = ["selecionada", "analise", "prompts", "gerando", "edicao"];

export interface LifecyclePipe {
  etapa: string;
  post_url?: string | null;
  postado_em?: string | null;
  agendado_para?: string | null;
  clips?: number;
  clips_total?: number;
}
export interface LifecycleRef { atribuida?: boolean; formato?: boolean; objetivo?: boolean }

/** Estágio de uma linha REF × personagem (regras 1-4 e 8 da SPEC §3.2). */
export function pipelineStage(p: LifecyclePipe, hoje = localDay()): { stage: Stage; sub: string; late: boolean } | null {
  if (p.etapa === "descartada") return null;
  const postada = p.etapa === "postado" || !!p.post_url;
  const late = !postada && !!p.agendado_para && localDay(p.agendado_para) < hoje;
  if (postada) return { stage: "postada", sub: p.postado_em ? shortDate(p.postado_em) : "", late: false };
  if (p.etapa === "pronto" || p.etapa === "agendado") {
    if (p.agendado_para && localDay(p.agendado_para) >= hoje) return { stage: "agendada", sub: shortDateTime(p.agendado_para), late };
    return { stage: "pronta", sub: late ? `venceu ${shortDate(p.agendado_para!)}` : "", late };
  }
  if (PRODUCAO.includes(p.etapa)) {
    const label = ETAPA_LABEL[p.etapa as Etapa] ?? "Seleção";
    const clips = p.clips_total ? ` ${p.clips ?? 0}/${p.clips_total}` : "";
    return { stage: "producao", sub: `${label}${clips}`, late };
  }
  return null;
}

/**
 * Estágio de uma referência (SPEC §3.2): o mais avançado entre os perfis; sem replicação,
 * atribuída > triada (formato + objetivo) > guardada. `late` = alguma linha atrasada.
 */
export function lifecycle(ref: LifecycleRef, pipelines: LifecyclePipe[], hoje = localDay()): { stage: Stage; late: boolean; extra: number } {
  const ativos = pipelines.map((p) => pipelineStage(p, hoje)).filter((x): x is NonNullable<typeof x> => !!x);
  if (ativos.length) {
    const top = ativos.reduce((a, b) => (STAGE_RANK[b.stage] > STAGE_RANK[a.stage] ? b : a));
    return { stage: top.stage, late: ativos.some((a) => a.late), extra: ativos.length - 1 };
  }
  if (ref.atribuida) return { stage: "atribuida", late: false, extra: 0 };
  if (ref.formato && ref.objetivo) return { stage: "triada", late: false, extra: 0 };
  return { stage: "guardada", late: false, extra: 0 };
}

/** refs.status derivado (SPEC §3.2 regra 10). */
export function derivedStatus(stage: Stage): "disponivel" | "producao" | "usada" {
  return stage === "postada" ? "usada" : stage === "producao" || stage === "pronta" || stage === "agendada" ? "producao" : "disponivel";
}

/**
 * O mesmo cálculo de `lifecycle()` em SQL (para filtrar por estágio, inclusive em coleções inteligentes).
 * Usa UM parâmetro: o dia local de hoje (localDay()). Mantido em paridade por tests/pipeline.test.ts.
 */
export function stageSql(r = "r"): string {
  const has = (cond: string) => `EXISTS (SELECT 1 FROM ref_pipeline p WHERE p.ref_id = ${r}.id AND ${cond})`;
  const facet = (key: string) => `EXISTS (SELECT 1 FROM ref_facet_values fx JOIN facet_values vx ON vx.id = fx.value_id JOIN facets kx ON kx.id = vx.facet_id WHERE fx.ref_id = ${r}.id AND kx.key = '${key}')`;
  return `CASE
    WHEN ${has("(p.etapa = 'postado' OR p.post_url IS NOT NULL) AND p.etapa <> 'descartada'")} THEN 'postada'
    WHEN ${has("p.etapa IN ('pronto','agendado') AND p.post_url IS NULL AND p.agendado_dia >= ?")} THEN 'agendada'
    WHEN ${has("p.etapa IN ('pronto','agendado') AND p.post_url IS NULL")} THEN 'pronta'
    WHEN ${has("p.etapa IN ('selecionada','analise','prompts','gerando','edicao') AND p.post_url IS NULL")} THEN 'producao'
    WHEN EXISTS (SELECT 1 FROM ref_clients rcx WHERE rcx.ref_id = ${r}.id) THEN 'atribuida'
    WHEN ${facet("formato")} AND ${facet("objetivo")} THEN 'triada'
    ELSE 'guardada' END`;
}

// ---------- perfis e slugs ----------

export interface ResolvedSlug {
  profileId: number | null;
  profileSlug: string | null;
  clients: { id: number; slug: string; name: string }[];
}

const parseAliases = (s: unknown): string[] => {
  try { const a = JSON.parse(String(s ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
};

/** Slug congelado do personagem (clients.slug); cai no slug do nome só para cadastros anteriores à migração 10. */
export function clientSlug(c: { slug?: string | null; name: string }): string {
  return c.slug || expertSlug(c.name);
}

/**
 * Aceita o slug do personagem (bruno-goytacazes), o do perfil (bruno-goytacaz) ou um alias.
 * Perfil com vários personagens (mini-chefs-da-vovo) devolve todos.
 */
export function resolveSlug(db: Database, slug: string): ResolvedSlug | null {
  const s = String(slug ?? "").trim().toLowerCase();
  if (!s) return null;
  const clientsOf = (pid: number) => (db.query("SELECT id, slug, name FROM clients WHERE profile_id = ? ORDER BY id").all(pid) as any[])
    .map((c) => ({ id: c.id, slug: clientSlug(c), name: c.name }));
  const c = (db.query("SELECT c.id, c.slug, c.name, c.profile_id, p.slug AS pslug FROM clients c LEFT JOIN profiles p ON p.id = c.profile_id WHERE c.slug = ?").get(s) as any);
  if (c) return { profileId: c.profile_id ?? null, profileSlug: c.pslug ?? null, clients: [{ id: c.id, slug: clientSlug(c), name: c.name }] };
  const profiles = db.query("SELECT id, slug, aliases FROM profiles").all() as any[];
  const p = profiles.find((x) => x.slug === s) ?? profiles.find((x) => parseAliases(x.aliases).includes(s));
  if (p) return { profileId: p.id, profileSlug: p.slug, clients: clientsOf(p.id) };
  // Cadastro antigo sem slug gravado: compara pelo slug do nome.
  const byName = (db.query("SELECT id, slug, name FROM clients").all() as any[]).find((x) => !x.slug && expertSlug(x.name) === s);
  if (byName) return { profileId: null, profileSlug: null, clients: [{ id: byName.id, slug: s, name: byName.name }] };
  return null;
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** Sugestão para um slug desconhecido: o perfil/personagem mais parecido (para o estado vazio honesto). */
export function suggestSlug(db: Database, slug: string): { slug: string; name: string } | null {
  const opts: { slug: string; name: string }[] = [
    ...(db.query("SELECT slug, name FROM profiles").all() as any[]),
    ...(db.query("SELECT slug, name FROM clients WHERE slug IS NOT NULL").all() as any[]),
  ];
  let best: { slug: string; name: string } | null = null, bestD = Infinity;
  for (const o of opts) {
    const dd = o.slug.startsWith(slug) || slug.startsWith(o.slug) ? 0 : distance(slug, o.slug);
    if (dd < bestD) { bestD = dd; best = o; }
  }
  return best && bestD <= Math.max(3, Math.floor(slug.length / 4)) ? best : null;
}

export function expertNaoEncontrado(db: Database, slug: string): HttpError {
  const sugestao = suggestSlug(db, slug);
  return new HttpError(404, `expert não encontrado: ${slug}${sugestao ? ` (o Hub conhece como ${sugestao.name}: ${sugestao.slug})` : ""}`,
    { codigo: "expert_nao_encontrado", slug, sugestao });
}

// ---------- sincronização arquivos → ref_pipeline ----------

export type RepItem = {
  id: string; ref: string; slug?: string; expert?: string | null; etapa: string; formato?: string | null;
  clips?: number; clipsTotal?: number; editado?: string | null; postUrl?: string | null;
  postadoEm?: string | null; registradoEm?: string | null; arquivadoEm?: string | null;
};

const readJson = (f: string) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; } catch { return null; } };

function clientFor(db: Database, root: string, item: RepItem): number | null {
  if (!item.slug) return null;
  const bySlug = db.query("SELECT id FROM clients WHERE slug = ?").get(item.slug) as any;
  if (bySlug) return bySlug.id;
  const prep = readJson(join(root, "replicacoes", item.ref, item.slug, "preparacao.json"));
  if (prep?.input?.expert_id) {
    const byId = db.query("SELECT id FROM clients WHERE id = ?").get(Number(prep.input.expert_id)) as any;
    if (byId) return byId.id;
  }
  const byName = db.query("SELECT id FROM clients WHERE name = ? COLLATE NOCASE").get(item.expert ?? "") as any;
  return byName?.id ?? null;
}

function logEvent(db: Database, ref: string, clientId: number, de: string | null, para: string, origem: string, detalhe: string | null = null) {
  db.run("INSERT INTO ref_pipeline_events (ref_id, client_id, de, para, origem, detalhe, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [ref, clientId, de, para, origem, detalhe, now()]);
}

/** Recalcula refs.status (derivado) para as referências indicadas, ou todas. */
export function refreshDerivedStatus(db: Database, refIds?: string[]) {
  const expr = `CASE
    WHEN EXISTS (SELECT 1 FROM ref_pipeline p WHERE p.ref_id = refs.id AND p.etapa <> 'descartada' AND (p.etapa = 'postado' OR p.post_url IS NOT NULL)) THEN 'usada'
    WHEN EXISTS (SELECT 1 FROM ref_pipeline p WHERE p.ref_id = refs.id AND p.etapa IN ('selecionada','analise','prompts','gerando','edicao','pronto','agendado')) THEN 'producao'
    ELSE 'disponivel' END`;
  if (refIds && !refIds.length) return;
  const scope = refIds ? ` AND id IN (${refIds.map(() => "?").join(",")})` : "";
  db.run(`UPDATE refs SET status = ${expr} WHERE status <> ${expr}${scope}`, refIds ?? []);
}

export interface SyncOptions {
  /** Só esta REF (após uma mutação). */
  ref?: string;
  /** Rótulo do evento gravado quando a etapa muda. */
  origem?: string;
  /** Itens já lidos (testes ou chamadores que já têm a lista). */
  items?: RepItem[];
}

/**
 * Espelha library/replicacoes em ref_pipeline. Grava evento quando a etapa muda.
 * Numa sincronização completa, linhas cuja pasta sumiu viram 'descartada' (nada é apagado).
 * Devolve todos os itens lidos (inclusive análises sem expert), usados pelo funil.
 */
export function syncPipeline(db: Database, root: string, opts: SyncOptions = {}): RepItem[] {
  const items: RepItem[] = opts.items ?? (listReplicacoes(db, root, opts.ref) as RepItem[]);
  const origem = opts.origem ?? "sync";
  const seen = new Set<string>();
  const touched = new Set<string>();
  // Publicação vem dos posts (seções do Postagens.md); a replicação só resume os posts dela.
  const resumo = resumoPorReplicacao(lerPostsVault(root));
  db.transaction(() => {
    for (const it of items) {
      if (!it.slug) continue;
      if (opts.ref && it.ref !== opts.ref) continue;
      if (!db.query("SELECT 1 FROM refs WHERE id = ?").get(it.ref)) continue;
      const clientId = clientFor(db, root, it);
      if (clientId == null) continue;
      seen.add(`${it.ref}|${clientId}`);
      let postadoEm = it.postadoEm, registradoEm = it.registradoEm;
      if (postadoEm === undefined && !opts.items) {
        const cfg = readJson(join(root, "replicacoes", it.ref, it.slug, "flow-producao.json"));
        postadoEm = typeof cfg?.postadoEm === "string" ? cfg.postadoEm : null;
        registradoEm = typeof cfg?.registradoEm === "string" ? cfg.registradoEm : null;
      }
      const next = {
        etapa: it.arquivadoEm ? "descartada" : ETAPA_LABEL[it.etapa as Etapa] ? it.etapa : "analise",
        formato: it.formato ?? null, clips: it.clips ?? 0, clips_total: it.clipsTotal ?? 0, editado: it.editado ? 1 : 0,
        post_url: it.postUrl ?? null, postado_em: postadoEm ?? null, registrado_em: registradoEm ?? null,
      };
      const rp = resumo.get(it.id);
      let agendado: string | null | undefined;
      if (rp || geridoPelaNota(it.slug)) {
        const r = rp ?? { total: 0, postados: 0, abertos: 0, arquivados: 0, post_url: null, postado_em: null, agendado_para: null };
        const producao = next.etapa === "postado" ? (it.editado ? "pronto" : "edicao") : next.etapa;
        next.etapa = r.total && r.arquivados === r.total ? "descartada" : r.postados && !r.abertos ? "postado" : producao === "postado" ? "pronto" : producao;
        next.post_url = r.postados && !r.abertos ? r.post_url : null;
        next.postado_em = r.postados && !r.abertos ? r.postado_em : null;
        next.registrado_em = null;
        agendado = r.agendado_para;
      }
      const row = db.query("SELECT * FROM ref_pipeline WHERE ref_id = ? AND client_id = ?").get(it.ref, clientId) as any;
      if (agendado !== undefined && row && row.agendado_para !== agendado) {
        db.run("UPDATE ref_pipeline SET agendado_para = ?, agendado_dia = ? WHERE ref_id = ? AND client_id = ?", [agendado, agendado ? localDay(agendado) : null, it.ref, clientId]);
        touched.add(it.ref);
      }
      if (!row) {
        db.run(`INSERT INTO ref_pipeline (ref_id, client_id, etapa, formato_replicacao, clips, clips_total, editado, post_url, postado_em, registrado_em, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [it.ref, clientId, next.etapa, next.formato, next.clips, next.clips_total, next.editado, next.post_url, next.postado_em, next.registrado_em, now()]);
        if (agendado) db.run("UPDATE ref_pipeline SET agendado_para = ?, agendado_dia = ? WHERE ref_id = ? AND client_id = ?", [agendado, localDay(agendado), it.ref, clientId]);
        logEvent(db, it.ref, clientId, null, next.etapa, origem);
        touched.add(it.ref);
        continue;
      }
      const changed = row.etapa !== next.etapa || row.formato_replicacao !== next.formato || row.clips !== next.clips || row.clips_total !== next.clips_total
        || row.editado !== next.editado || row.post_url !== next.post_url || row.postado_em !== next.postado_em || row.registrado_em !== next.registrado_em;
      if (!changed) continue;
      db.run(`UPDATE ref_pipeline SET etapa = ?, formato_replicacao = ?, clips = ?, clips_total = ?, editado = ?, post_url = ?, postado_em = ?, registrado_em = ?, updated_at = ?
        WHERE ref_id = ? AND client_id = ?`,
        [next.etapa, next.formato, next.clips, next.clips_total, next.editado, next.post_url, next.postado_em, next.registrado_em, now(), it.ref, clientId]);
      if (row.etapa !== next.etapa) logEvent(db, it.ref, clientId, row.etapa, next.etapa, origem);
      else if (row.post_url !== next.post_url || row.postado_em !== next.postado_em) logEvent(db, it.ref, clientId, row.etapa, next.etapa, origem, "postagem atualizada");
      touched.add(it.ref);
    }
    // Pasta sumiu numa leitura completa (e não vazia): marca 'descartada' com evento, sem apagar.
    if (!opts.ref && !opts.items && items.length && existsSync(join(root, "replicacoes"))) {
      for (const r of db.query("SELECT ref_id, client_id, etapa FROM ref_pipeline WHERE etapa <> 'descartada'").all() as any[]) {
        if (seen.has(`${r.ref_id}|${r.client_id}`)) continue;
        db.run("UPDATE ref_pipeline SET etapa = 'descartada', updated_at = ? WHERE ref_id = ? AND client_id = ?", [now(), r.ref_id, r.client_id]);
        logEvent(db, r.ref_id, r.client_id, r.etapa, "descartada", origem, "pasta da replicação não encontrada");
        touched.add(r.ref_id);
      }
    }
    refreshDerivedStatus(db, opts.ref ? [opts.ref] : undefined);
  })();
  const snap = snapshots.get(db);
  if (opts.ref || opts.items) { if (snap) snap.at = 0; }
  else snapshots.set(db, { at: Date.now(), items });
  return items;
}

// Leitura completa dos arquivos no máximo a cada SNAPSHOT_MS (as rotas GET chamam pipelineSnapshot antes de responder).
const SNAPSHOT_MS = 1500;
const snapshots = new WeakMap<Database, { at: number; items: RepItem[] }>();

export function pipelineSnapshot(ctx: Ctx, maxAgeMs = SNAPSHOT_MS): RepItem[] {
  const s = snapshots.get(ctx.db);
  if (s && Date.now() - s.at < maxAgeMs) return s.items;
  return syncPipeline(ctx.db, ctx.root);
}

/** Força a próxima leitura completa (depois de uma escrita fora do syncPipeline). */
export function invalidatePipeline(db: Database) {
  const s = snapshots.get(db);
  if (s) s.at = 0;
}

// ---------- leitura ----------

const PIPE_SELECT = `SELECT p.*, c.name AS client_name, c.slug AS client_slug, pr.slug AS profile_slug, r.thumb_path
  FROM ref_pipeline p JOIN clients c ON c.id = p.client_id LEFT JOIN profiles pr ON pr.id = c.profile_id JOIN refs r ON r.id = p.ref_id`;

/** Linhas de ciclo por referência (para o card e o viewer). */
export function pipelinesByRef(db: Database, refIds?: string[], withEvents = false): Map<string, RefPipeline[]> {
  const out = new Map<string, RefPipeline[]>();
  const hoje = localDay();
  const where = refIds ? (refIds.length ? `WHERE p.ref_id IN (${refIds.map(() => "?").join(",")}) AND p.etapa <> 'descartada'` : "WHERE 0") : "WHERE p.etapa <> 'descartada'";
  const rows = db.query(`${PIPE_SELECT} ${where} ORDER BY c.name`).all(...(refIds ?? [])) as any[];
  // No detalhe (withEvents) a nota é lida para dizer quantos posts de cada replicação estão no ar.
  const resumo = withEvents ? resumoPorReplicacao(lerPostsVault()) : null;
  for (const p of rows) {
    const st = pipelineStage(p, hoje);
    if (!st) continue;
    const slug = clientSlug({ slug: p.client_slug, name: p.client_name });
    const item: RefPipeline = {
      id: `${p.ref_id}--${slug}`, profile: p.profile_slug ?? null, client: { id: p.client_id, name: p.client_name, slug },
      stage: st.stage, sub: st.sub, late: st.late, etapa: p.etapa, clips: p.clips, clipsTotal: p.clips_total,
      postUrl: p.post_url, postadoEm: p.postado_em, agendadoPara: p.agendado_para,
    };
    if (resumo) {
      const r = resumo.get(item.id);
      item.posts = r ? { total: r.total, postados: r.postados, abertos: r.abertos, arquivados: r.arquivados } : null;
    }
    if (withEvents) {
      item.events = db.query("SELECT de, para, origem, detalhe, at FROM ref_pipeline_events WHERE ref_id = ? AND client_id = ? ORDER BY at, id")
        .all(p.ref_id, p.client_id) as PipelineEvent[];
    }
    const a = out.get(p.ref_id);
    a ? a.push(item) : out.set(p.ref_id, [item]);
  }
  return out;
}

function toItem(p: any, hoje: string): PipelineItem | null {
  const st = pipelineStage(p, hoje);
  if (!st) return null;
  const slug = clientSlug({ slug: p.client_slug, name: p.client_name });
  const id = `${p.ref_id}--${slug}`;
  return {
    id, ref: p.ref_id, client_slug: slug, client_name: p.client_name, profile_slug: p.profile_slug ?? null,
    etapa: p.etapa, stage: st.stage, sub: st.sub, late: st.late, formato: p.formato_replicacao ?? null,
    clips: p.clips, clipsTotal: p.clips_total,
    editado_url: p.editado ? `/api/replicacoes/${id}/producao/editado` : null,
    capa_url: p.thumb_path ? `/media/${p.thumb_path}` : null,
    post_url: p.post_url, postado_em: p.postado_em, registrado_em: p.registrado_em, agendado_para: p.agendado_para,
    hub_url: `/producao/${id}/referencia`,
  };
}

const PUBLIC_STAGE: Record<Stage, PublicStage | null> = {
  guardada: null, triada: null, atribuida: null, producao: "producao", pronta: "pronto", agendada: "agendado", postada: "no_ar",
};

/** Contrato único GET /api/pipeline. `profile` aceita perfil, personagem ou alias; ausente = todos. */
export function listPipeline(ctx: Ctx, profile?: string | null, publico = false): PipelineResponse | PublicPipelineResponse {
  const { db } = ctx;
  let clientIds: number[] | null = null, canonical: string | null = null;
  if (profile) {
    const r = resolveSlug(db, profile);
    if (!r) throw expertNaoEncontrado(db, profile);
    clientIds = r.clients.map((c) => c.id);
    canonical = r.profileSlug ?? r.clients[0]?.slug ?? profile;
  }
  const hoje = localDay();
  const where = ["p.etapa <> 'descartada'"];
  if (clientIds) where.push(clientIds.length ? `p.client_id IN (${clientIds.map(() => "?").join(",")})` : "0");
  const rows = db.query(`${PIPE_SELECT} WHERE ${where.join(" AND ")} ORDER BY p.ref_id, c.name`).all(...(clientIds ?? [])) as any[];
  const itens = rows.map((p) => toItem(p, hoje)).filter((x): x is PipelineItem => !!x);
  const lido_em = now();
  if (publico) {
    return {
      profile: canonical, lido_em,
      itens: itens.flatMap((i) => {
        const stage = PUBLIC_STAGE[i.stage];
        return stage ? [{ ref: i.ref, num: i.ref.slice(-4), stage, post_url: i.post_url, postado_em: i.postado_em }] : [];
      }),
    };
  }
  // REFs arquivadas pelo Matheus (não as de pasta sumida): o painel privado tira da fila o item do Postagens.md com essa REF.
  const posts = lerPostsVault(ctx.root);
  const res0 = resumoPorReplicacao(posts);
  const desc = db.query(`${PIPE_SELECT} WHERE p.etapa = 'descartada'${clientIds ? (clientIds.length ? ` AND p.client_id IN (${clientIds.map(() => "?").join(",")})` : " AND 0") : ""}`).all(...(clientIds ?? [])) as any[];
  const arquivados = desc.flatMap((p) => {
    const slug = clientSlug({ slug: p.client_slug, name: p.client_name });
    const cfg = readJson(join(ctx.root, "replicacoes", p.ref_id, slug, "flow-producao.json"));
    if (typeof cfg?.arquivadoEm === "string") return [{ id: `${p.ref_id}--${slug}`, ref: p.ref_id, arquivado_em: cfg.arquivadoEm }];
    const r = res0.get(`${p.ref_id}--${slug}`);
    return r && r.total && r.arquivados === r.total ? [{ id: `${p.ref_id}--${slug}`, ref: p.ref_id, arquivado_em: "" }] : [];
  });
  for (const i of itens) {
    // Legenda da replicação = a do próximo post em aberto (senão o último postado): a mesma que o card do post mostra.
    const meus = posts.filter((p) => p.replicacao === i.id);
    const alvo = meus.filter((p) => p.publicacao === "a_publicar").sort((a, b) => (a.agendado_para ?? "9999").localeCompare(b.agendado_para ?? "9999"))[0]
      ?? meus.filter((p) => p.publicacao === "postado").at(-1);
    const l = alvo ? legendaDoPost(db, ctx.root, alvo) : legendaLegada(ctx.root, i.ref, i.client_slug);
    i.legenda = l?.texto ?? null; i.legenda_fonte = l?.fonte === "post" ? "nota" : (l?.fonte as any) ?? null;
    const r = res0.get(i.id);
    if (r) i.posts = { total: r.total - r.arquivados, postados: r.postados, abertos: r.abertos };
  }
  const res: PipelineResponse = { profile: canonical, lido_em, itens, arquivados };
  if (profile && canonical && profile !== canonical) res.pedido = profile;
  return res;
}

export function getPipelineItem(ctx: Ctx, ref: string, clientId: number): PipelineItem | null {
  const p = ctx.db.query(`${PIPE_SELECT} WHERE p.ref_id = ? AND p.client_id = ?`).get(ref, clientId) as any;
  return p ? toItem(p, localDay()) : null;
}

/** PATCH /api/pipeline/:id — só agenda. Postado continua em PATCH /api/replicacoes/:id. */
export function patchPipeline(ctx: Ctx, id: string, body: any): PipelineItem {
  const { db, root } = ctx;
  if (!body || typeof body !== "object" || !("agendado_para" in body)) throw new HttpError(400, "Informe agendado_para (data ISO ou null)");
  const agendado = parseIsoInput(body.agendado_para, "agendado_para");
  const { ref, slug } = resolveReplicacaoId(db, root, id);
  if (!slug) throw new HttpError(400, "Agendamento é por REF × expert (use <REF>--<slug>)");
  if (geridoPelaNota(slug)) {
    // Agenda mora no post (seção do Postagens.md): o pedido (`post`) ou o próximo em aberto (cria se não houver).
    const p = alvoDaReplicacao(db, root, `${ref}--${slug}`, body.post, "aberto")!;
    atualizarPost(p.id, { agendado_para: agendado });
  }
  syncPipeline(db, root, { ref });
  const client = db.query("SELECT id FROM clients WHERE slug = ?").get(slug) as any
    ?? (db.query("SELECT id, slug, name FROM clients").all() as any[]).find((c) => clientSlug(c) === slug);
  const row = client && db.query("SELECT * FROM ref_pipeline WHERE ref_id = ? AND client_id = ?").get(ref, client.id) as any;
  if (!row) throw new HttpError(404, "Replicação não encontrada");
  const hoje = localDay();
  const before = pipelineStage(row, hoje);
  const after = pipelineStage({ ...row, agendado_para: agendado }, hoje);
  db.transaction(() => {
    db.run("UPDATE ref_pipeline SET agendado_para = ?, agendado_dia = ?, updated_at = ? WHERE ref_id = ? AND client_id = ?",
      [agendado, agendado ? localDay(agendado) : null, now(), ref, client.id]);
    logEvent(db, ref, client.id, before?.stage ?? row.etapa, after?.stage ?? row.etapa, "agenda",
      agendado ? `agendado para ${agendado}` : "agendamento removido");
  })();
  return getPipelineItem(ctx, ref, client.id)!;
}

// ---------- perfis, funil ----------

const emptyCounts = (): StageCounts => ({ ...Object.fromEntries(STAGES.map((s) => [s, 0])), analise: 0 } as StageCounts);

export function listProfiles(ctx: Ctx): Profile[] {
  const { db } = ctx;
  const hoje = localDay();
  const profiles = db.query("SELECT * FROM profiles ORDER BY name").all() as any[];
  const rows = db.query(`${PIPE_SELECT} WHERE p.etapa <> 'descartada'`).all() as any[];
  return profiles.map((p) => {
    const chars = (db.query(`SELECT c.id, c.name, c.slug, c.avatar, c.color,
        (SELECT count(*) FROM ref_clients WHERE client_id = c.id) AS ref_count,
        (SELECT count(*) FROM ref_pipeline WHERE client_id = c.id AND etapa <> 'descartada') AS replicacoes
      FROM clients c WHERE c.profile_id = ? ORDER BY c.name`).all(p.id) as any[]).map((c) => ({ ...c, slug: clientSlug(c) }));
    const ids = new Set(chars.map((c) => c.id));
    const stages = emptyCounts();
    const mine = rows.filter((r) => ids.has(r.client_id));
    for (const r of mine) {
      const st = pipelineStage(r, hoje);
      if (!st) continue;
      if (r.etapa === "analise") stages.analise++;
      stages[st.stage]++;
    }
    const idList = [...ids];
    const refCount = idList.length
      ? (db.query(`SELECT count(DISTINCT ref_id) n FROM ref_clients WHERE client_id IN (${idList.map(() => "?").join(",")})`).get(...idList) as any).n
      : 0;
    stages.atribuida = idList.length
      ? (db.query(`SELECT count(DISTINCT rc.ref_id) n FROM ref_clients rc WHERE rc.client_id IN (${idList.map(() => "?").join(",")})
          AND NOT EXISTS (SELECT 1 FROM ref_pipeline p WHERE p.ref_id = rc.ref_id AND p.client_id = rc.client_id AND p.etapa <> 'descartada')`).get(...idList) as any).n
      : 0;
    return {
      id: p.id, slug: p.slug, name: p.name, ativo: profileAtivo(p.slug), tipo: p.tipo, instagram: p.instagram ?? null, vault_path: p.vault_path ?? null,
      painel_slug: p.painel_slug ?? null, aliases: parseAliases(p.aliases), personagens: chars,
      ref_count: refCount, replicacoes: mine.length, stages,
    };
  });
}

/** Funil da biblioteca (faixa de fluxo): replicações por etapa + referências sem destino. */
export function funnel(ctx: Ctx, lidos?: RepItem[]): Funnel {
  const { db } = ctx;
  const items = lidos ?? pipelineSnapshot(ctx);
  const hoje = localDay();
  const etapas = { analise: 0, prompts: 0, gerando: 0, edicao: 0, pronto: 0, postado: 0 } as Record<Etapa, number>;
  const f: Funnel = { sem_destino: 0, atribuida: 0, analise: 0, producao: 0, pronta: 0, agendada: 0, postada: 0, etapas };
  const agenda = new Map<string, string | null>();
  for (const r of db.query("SELECT p.ref_id, p.agendado_para, p.post_url, c.slug, c.name FROM ref_pipeline p JOIN clients c ON c.id = p.client_id").all() as any[]) {
    agenda.set(`${r.ref_id}--${clientSlug(r)}`, r.agendado_para);
  }
  const comReplicacao = new Set<string>();
  for (const it of items) {
    // Mesma regra do sync: replicação sem expert não vira linha em ref_pipeline, então o filtro não a enxerga.
    if (!it.slug) continue;
    comReplicacao.add(it.ref);
    const e = (ETAPA_LABEL[it.etapa as Etapa] ? it.etapa : "analise") as Etapa;
    etapas[e]++;
    const st = e === "analise" ? null : pipelineStage({ etapa: e, post_url: it.postUrl, agendado_para: agenda.get(it.id) ?? null }, hoje);
    if (!st) f.analise++;
    else if (st.stage === "producao") f.producao++;
    else if (st.stage === "pronta") f.pronta++;
    else if (st.stage === "agendada") f.agendada++;
    else if (st.stage === "postada") f.postada++;
  }
  for (const r of db.query("SELECT r.id, EXISTS (SELECT 1 FROM ref_clients WHERE ref_id = r.id) AS a FROM refs r").all() as any[]) {
    if (comReplicacao.has(r.id)) continue;
    if (r.a) f.atribuida++; else f.sem_destino++;
  }
  return f;
}
