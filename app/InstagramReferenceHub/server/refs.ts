import type { Database } from "bun:sqlite";
import { existsSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { now } from "./db";
import { extractCta, extractCtaActions, extractHashtags, safeJoin, videoFileName } from "./library";
import { lifecycle, localDay, pipelinesByRef, resolveSlug, stageSql } from "./pipeline";
import { ANALYSIS_FIELDS, STAGES, type Chip, type FacetChip, type Filters, type Metrics, type Origem, type RefCard, type RefDetail, type RefMedia, type RefPipeline } from "./types";

export interface Ctx { db: Database; root: string }

const LATEST = `LEFT JOIN metric_snapshots m ON m.id = (
  SELECT id FROM metric_snapshots WHERE ref_id = r.id ORDER BY collected_at DESC, id DESC LIMIT 1)`;
const ENGAGEMENT = `CASE WHEN m.views > 0 THEN (COALESCE(m.likes,0) + COALESCE(m.comments,0)) * 100.0 / m.views END`;

/** Converte busca livre em consulta FTS5 segura: cada termo vira prefixo, todos obrigatórios. */
export function ftsQuery(q: string): string | null {
  const terms = q.normalize("NFC").split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean);
  return terms.length ? terms.map((t) => `"${t}"*`).join(" ") : null;
}

const ids = (a: unknown): number[] => (Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : []);
const inList = (n: number) => Array(n).fill("?").join(",");

export function buildWhere(db: Database, f: Filters, nested = false) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const joinParams: (string | number)[] = [];
  let join = "";
  let rank = false;

  if (f.collection) {
    const c = db.query("SELECT kind, filters FROM collections WHERE id = ?").get(f.collection) as any;
    if (c?.kind === "smart" && c.filters) {
      const saved = JSON.parse(c.filters) as Filters;
      const inner = buildWhere(db, { ...saved, collection: undefined }, true);
      where.push(...inner.where);
      params.push(...inner.params);
    } else {
      where.push("r.id IN (SELECT ref_id FROM collection_refs WHERE collection_id = ?)");
      params.push(f.collection);
    }
  }
  const q = f.q ? ftsQuery(f.q) : null;
  if (q && nested) {
    where.push("r.id IN (SELECT ref_id FROM refs_fts WHERE refs_fts MATCH ?)");
    params.push(q);
  } else if (q) {
    join += " JOIN (SELECT ref_id, bm25(refs_fts) AS rank FROM refs_fts WHERE refs_fts MATCH ?) s ON s.ref_id = r.id";
    joinParams.push(q);
    rank = true;
  }
  const rel = (table: string, col: string, list: number[]) => {
    if (!list.length) return;
    where.push(`EXISTS (SELECT 1 FROM ${table} x WHERE x.ref_id = r.id AND x.${col} IN (${inList(list.length)}))`);
    params.push(...list);
  };
  rel("ref_clients", "client_id", ids(f.clients));
  rel("ref_projects", "project_id", ids(f.projects));
  rel("ref_categories", "category_id", ids(f.categories));
  rel("ref_tags", "tag_id", ids(f.tags));

  if (f.creator) {
    where.push("(r.username LIKE ? OR r.display_name LIKE ?)");
    const like = `%${f.creator.replace(/^@/, "")}%`;
    params.push(like, like);
  }
  if (f.status?.length) {
    where.push(`r.status IN (${inList(f.status.length)})`);
    params.push(...f.status);
  }
  if (f.kind?.length) {
    where.push(`r.kind IN (${inList(f.kind.length)})`);
    params.push(...f.kind);
  }
  if (f.favorite) where.push("r.favorite = 1");
  // Facetas: OU dentro do eixo, E entre eixos. Valor mesclado (merged_into) conta pelo destino.
  if (f.facets && typeof f.facets === "object") {
    for (const [key, list] of Object.entries(f.facets)) {
      const vals = ids(list).filter((x) => x > 0);
      // 0 = "sem nada marcado" neste eixo.
      const vazio = Array.isArray(list) && list.some((x) => Number(x) === 0);
      if (!vals.length && !vazio) continue;
      const conds: string[] = [];
      if (vals.length) {
        conds.push(`EXISTS (SELECT 1 FROM ref_facet_values fv JOIN facet_values v ON v.id = fv.value_id
        WHERE fv.ref_id = r.id AND (v.id IN (${inList(vals.length)}) OR v.merged_into IN (${inList(vals.length)})))`);
        params.push(...vals, ...vals);
      }
      if (vazio) {
        conds.push(`NOT EXISTS (SELECT 1 FROM ref_facet_values fv JOIN facet_values v ON v.id = fv.value_id JOIN facets fa ON fa.id = v.facet_id
        WHERE fv.ref_id = r.id AND fa.key = ?)`);
        params.push(key);
      }
      where.push(`(${conds.join(" OR ")})`);
    }
  }
  const stages = (f.stage ?? []).filter((x) => (STAGES as string[]).includes(x));
  if (stages.length) {
    where.push(`(${stageSql("r")}) IN (${inList(stages.length)})`);
    params.push(localDay(), ...stages);
  }
  if (f.profile) {
    const p = resolveSlug(db, f.profile);
    const cids = p?.clients.map((c) => c.id) ?? [];
    if (!cids.length) where.push("0");
    else {
      where.push(`(EXISTS (SELECT 1 FROM ref_clients x WHERE x.ref_id = r.id AND x.client_id IN (${inList(cids.length)}))
        OR EXISTS (SELECT 1 FROM ref_pipeline x WHERE x.ref_id = r.id AND x.etapa <> 'descartada' AND x.client_id IN (${inList(cids.length)})))`);
      params.push(...cids, ...cids);
    }
  }
  const origens = (f.origem ?? []).filter((o) => ["instagram", "op001", "mapeamento", "upload"].includes(o));
  if (origens.length) {
    where.push(`${ORIGEM_SQL} IN (${inList(origens.length)})`);
    params.push(...origens);
  }
  if (f.sem_criador) where.push("(r.username IS NULL OR r.username = '')");
  if (f.cta) {
    where.push("r.cta_keyword = ?");
    params.push(f.cta.toUpperCase());
  }
  const range = (col: string, from?: string, to?: string) => {
    if (from) { where.push(`${col} >= ?`); params.push(from); }
    if (to) { where.push(`${col} < date(?, '+1 day')`); params.push(to); }
  };
  range("r.published_at", f.publishedFrom, f.publishedTo);
  range("r.imported_at", f.importedFrom, f.importedTo);
  const min = (expr: string, v?: number) => {
    if (v != null && Number.isFinite(Number(v))) { where.push(`${expr} >= ?`); params.push(Number(v)); }
  };
  min("m.views", f.minViews);
  min("m.likes", f.minLikes);
  min("m.comments", f.minComments);
  min(ENGAGEMENT, f.minEngagement);

  return { join, joinParams, where, params, rank };
}

/** Origem gravada pela migração 8 / importador; para linhas antigas sem valor, deriva de source. */
const ORIGEM_SQL = "coalesce(r.origem, CASE WHEN r.source = 'instagram' THEN 'instagram' ELSE 'upload' END)";

const ORDER: Record<string, string> = {
  recentes: "r.imported_at DESC, r.id DESC",
  antigos: "r.imported_at ASC, r.id ASC",
  publicacao: "r.published_at IS NULL, r.published_at DESC",
  views: "m.views IS NULL, m.views DESC",
  likes: "m.likes IS NULL, m.likes DESC",
  comments: "m.comments IS NULL, m.comments DESC",
  engajamento: "engagement IS NULL, engagement DESC",
};

export function listRefs({ db }: Ctx, f: Filters = {}, limit = 2000): { items: RefCard[]; total: number } {
  const w = buildWhere(db, f);
  const sort = f.sort ?? "relevancia";
  const order = sort === "relevancia"
    ? (w.rank ? "s.rank, r.imported_at DESC" : "r.favorite DESC, r.imported_at DESC, r.id DESC")
    : ORDER[sort] ?? ORDER.recentes;
  const sql = `SELECT r.*, m.views, m.likes, m.comments, m.collected_at AS m_at, m.source AS m_source, ${ENGAGEMENT} AS engagement
    FROM refs r ${LATEST} ${w.join}
    ${w.where.length ? "WHERE " + w.where.join(" AND ") : ""}
    ORDER BY ${order} LIMIT ${Math.max(1, Math.min(limit, 5000))}`;
  const rows = db.query(sql).all(...w.joinParams, ...w.params) as any[];
  const chips = relationChips(db, rows.map((r) => r.id));
  const items = rows.map((r) => toCard(r, chips));
  return { items, total: items.length };
}

function relationChips(db: Database, refIds: string[]) {
  const clients = new Map<string, Chip[]>();
  const cats = new Map<string, Chip[]>();
  const cols = new Map<string, Chip[]>();
  const formatos = new Map<number, Chip>();
  for (const r of db.query("SELECT id, name FROM formatos").all() as any[]) formatos.set(r.id, { id: r.id, name: r.name });
  if (!refIds.length) return { clients, cats, cols, formatos, facets: new Map<string, Record<string, FacetChip[]>>(), media: new Map<string, RefMedia[]>(), pipes: new Map<string, RefPipeline[]>() };
  // ponytail: carrega todas as relações de uma vez; filtrar por id quando a biblioteca passar de ~10 mil refs
  const set = new Set(refIds);
  for (const r of db.query("SELECT rc.ref_id, c.id, c.name, c.color FROM ref_clients rc JOIN clients c ON c.id = rc.client_id ORDER BY c.name").all() as any[]) {
    if (set.has(r.ref_id)) push(clients, r.ref_id, { id: r.id, name: r.name, color: r.color });
  }
  for (const r of db.query("SELECT rc.ref_id, c.id, c.name FROM ref_categories rc JOIN categories c ON c.id = rc.category_id ORDER BY rc.rowid").all() as any[]) {
    if (set.has(r.ref_id)) push(cats, r.ref_id, { id: r.id, name: r.name });
  }
  for (const r of db.query("SELECT cr.ref_id, c.id, c.name FROM collection_refs cr JOIN collections c ON c.id = cr.collection_id ORDER BY c.name").all() as any[]) {
    if (set.has(r.ref_id)) push(cols, r.ref_id, { id: r.id, name: r.name });
  }
  const facets = new Map<string, Record<string, FacetChip[]>>();
  for (const r of db.query(`SELECT fv.ref_id, fv.source, v.id, v.name, f.key FROM ref_facet_values fv
      JOIN facet_values v ON v.id = fv.value_id JOIN facets f ON f.id = v.facet_id ORDER BY f.position, v.position, v.name`).all() as any[]) {
    if (!set.has(r.ref_id)) continue;
    const m = facets.get(r.ref_id) ?? {};
    (m[r.key] ??= []).push({ id: r.id, name: r.name, source: r.source });
    facets.set(r.ref_id, m);
  }
  const media = new Map<string, RefMedia[]>();
  for (const r of db.query("SELECT ref_id, position, type, path, thumb_path, width, height FROM ref_media ORDER BY ref_id, position").all() as any[]) {
    if (set.has(r.ref_id)) push(media, r.ref_id, { position: r.position, type: r.type, path: r.path, thumb: r.thumb_path, width: r.width, height: r.height });
  }
  const pipes = pipelinesByRef(db, refIds.length > 500 ? undefined : refIds);
  return { clients, cats, cols, formatos, facets, media, pipes };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const a = m.get(k);
  a ? a.push(v) : m.set(k, [v]);
}

function metricsOf(r: any): Metrics | null {
  return r.m_at ? { views: r.views, likes: r.likes, comments: r.comments, collected_at: r.m_at, source: r.m_source } : null;
}

/** Mídias do post: ref_media quando existe; senão a mídia única da referência (bibliotecas antigas / import antes do H2). */
function mediaOf(r: any, rows: RefMedia[] | undefined): RefMedia[] {
  if (rows?.length) return rows;
  const path = r.video_path ?? r.thumb_path;
  return path ? [{ position: 0, type: r.video_path ? "video" : "imagem", path, thumb: r.thumb_path, width: r.width, height: r.height }] : [];
}

function toCard(r: any, chips: ReturnType<typeof relationChips>, mediaLimit = 10): RefCard {
  const facets = chips.facets.get(r.id) ?? {};
  const pipeline = chips.pipes.get(r.id) ?? [];
  const media = mediaOf(r, chips.media.get(r.id));
  const clients = chips.clients.get(r.id) ?? [];
  const life = lifecycle(
    { atribuida: clients.length > 0, formato: !!facets.formato?.length, objetivo: !!facets.objetivo?.length },
    pipeline.map((p) => ({ etapa: p.etapa, post_url: p.postUrl, postado_em: p.postadoEm, agendado_para: p.agendadoPara })),
  );
  const origem: Origem = r.origem ?? (r.source === "instagram" ? "instagram" : "upload");
  return {
    id: r.id, kind: r.kind, source: r.source, username: r.username, display_name: r.display_name,
    caption_head: (r.caption as string).split("\n").find((l) => l.trim())?.slice(0, 160) ?? "",
    cta_keyword: r.cta_keyword, published_at: r.published_at, imported_at: r.imported_at,
    duration: r.duration, width: r.width, height: r.height,
    // status é derivado do ciclo (SPEC §3.2 regra 10); a coluna é só o cache gravado pelo syncPipeline.
    video_path: r.video_path, thumb_path: r.thumb_path,
    status: life.stage === "postada" ? "usada" : ["producao", "pronta", "agendada"].includes(life.stage) ? "producao" : "disponivel",
    favorite: !!r.favorite,
    metrics: metricsOf(r), engagement: r.engagement ?? null,
    clients, categories: chips.cats.get(r.id) ?? [],
    collections: chips.cols.get(r.id) ?? [],
    formato: chips.formatos.get(r.formato_id) ?? null,
    cta_actions: extractCtaActions(r.caption),
    stage: life.stage,
    pipeline,
    media_count: Math.max(r.media_count ?? 1, media.length),
    media: media.slice(0, mediaLimit),
    creator_guess: r.creator_guess ?? null,
    origem,
    legacy_id: r.legacy_id ?? null,
    product_type: r.product_type ?? null,
    facets,
  };
}

export function getRef({ db, root }: Ctx, id: string): RefDetail | null {
  const r = db.query(`SELECT r.*, m.views, m.likes, m.comments, m.collected_at AS m_at, m.source AS m_source, ${ENGAGEMENT} AS engagement
    FROM refs r ${LATEST} WHERE r.id = ?`).get(id) as any;
  if (!r) return null;
  const chips = relationChips(db, [id]);
  chips.pipes = pipelinesByRef(db, [id], true);
  const card = toCard(r, chips, Number.MAX_SAFE_INTEGER);
  const abs = r.video_path ? safeJoin(root, r.video_path) : r.thumb_path ? safeJoin(root, r.thumb_path) : null;
  return {
    ...card,
    shortcode: r.shortcode, url: r.url, caption: r.caption, hashtags: r.hashtags,
    filmstrip_path: r.filmstrip_path, file_hash: r.file_hash, file_size: r.file_size,
    cuts: r.cuts, avg_shot: r.avg_shot, notes: r.notes, transcript: r.transcript ?? "",
    angulo_analise: r.angulo_analise ? JSON.parse(r.angulo_analise) : null,
    hook: r.hook, script_structure: r.script_structure, editing_technique: r.editing_technique,
    save_reason: r.save_reason, adaptation: r.adaptation, derived_ideas: r.derived_ideas, updated_at: r.updated_at,
    projects: db.query("SELECT p.id, p.name, p.client_id FROM ref_projects rp JOIN projects p ON p.id = rp.project_id WHERE rp.ref_id = ? ORDER BY p.name").all(id) as any,
    tags: db.query("SELECT t.id, t.name FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = ? ORDER BY t.name").all(id) as any,
    collections: db.query("SELECT c.id, c.name FROM collection_refs cr JOIN collections c ON c.id = cr.collection_id WHERE cr.ref_id = ? ORDER BY c.name").all(id) as any,
    markers: db.query("SELECT id, t, label FROM markers WHERE ref_id = ? ORDER BY t").all(id) as any,
    metric_history: db.query("SELECT views, likes, comments, collected_at, source FROM metric_snapshots WHERE ref_id = ? ORDER BY collected_at DESC, id DESC").all(id) as any,
    possible_duplicates: possibleDuplicatesOf(db, r),
    file_exists: !!abs && existsSync(abs),
    abs_path: abs,
  };
}

function possibleDuplicatesOf(db: Database, r: any): string[] {
  const out = new Set<string>();
  if (r.file_hash) {
    for (const x of db.query("SELECT id FROM refs WHERE file_hash = ? AND id <> ?").all(r.file_hash, r.id) as any[]) out.add(x.id);
  }
  if (r.duration && r.username) {
    for (const x of db.query(`SELECT id FROM refs WHERE id <> ? AND username = ? AND width IS ? AND height IS ?
      AND duration BETWEEN ? AND ?`).all(r.id, r.username, r.width, r.height, r.duration - 0.5, r.duration + 0.5) as any[]) out.add(x.id);
  }
  return [...out];
}

/** Grupos de possíveis duplicados em toda a biblioteca. */
export function duplicateGroups({ db }: Ctx): { reason: string; ids: string[] }[] {
  const groups: { reason: string; ids: string[] }[] = [];
  for (const g of db.query("SELECT group_concat(id) ids FROM refs WHERE file_hash IS NOT NULL GROUP BY file_hash HAVING count(*) > 1").all() as any[]) {
    groups.push({ reason: "Mesmo arquivo (SHA-256 idêntico)", ids: g.ids.split(",") });
  }
  const seen = new Set(groups.flatMap((g) => g.ids));
  const rows = db.query("SELECT id, username, duration, width, height FROM refs WHERE duration IS NOT NULL AND username IS NOT NULL ORDER BY username, duration").all() as any[];
  for (let i = 0; i < rows.length; i++) {
    const grp = [rows[i].id];
    for (let j = i + 1; j < rows.length && rows[j].username === rows[i].username && rows[j].duration - rows[i].duration <= 0.5; j++) {
      if (rows[j].width === rows[i].width && rows[j].height === rows[i].height) grp.push(rows[j].id);
    }
    if (grp.length > 1 && !grp.every((x) => seen.has(x))) {
      groups.push({ reason: "Mesmo criador, mesma duração (±0,5 s) e dimensão", ids: grp });
      grp.forEach((x) => seen.add(x));
    }
  }
  return groups;
}

export interface RefPatch {
  status?: string; favorite?: boolean; notes?: string;
  hook?: string; script_structure?: string; editing_technique?: string; save_reason?: string; adaptation?: string; derived_ideas?: string;
  username?: string; display_name?: string; published_at?: string | null; caption?: string;
  categories?: number[]; clients?: number[]; projects?: number[]; tags?: string[];
  formato_id?: number | null;
  /** Substitui os valores de cada eixo informado: { formato: [id], gancho: [id, id] }. Origem = manual. */
  facets?: Record<string, number[]>;
  creator_guess?: string | null;
}

/** Resposta do PATCH: o detalhe + avisos (ex.: status é derivado e foi ignorado). */
export type RefPatchResult = RefDetail & { warnings?: string[] };

const TEXT_FIELDS = ["notes", "username", "display_name", "caption", ...ANALYSIS_FIELDS.map(([k]) => k)] as const;

export function updateRef(ctx: Ctx, id: string, p: RefPatch): RefPatchResult {
  const { db } = ctx;
  if (!db.query("SELECT 1 FROM refs WHERE id = ?").get(id)) throw new HttpError(404, "Referência não encontrada");
  const warnings: string[] = [];
  if (p.status !== undefined) warnings.push("status é calculado pelo ciclo (replicação, agenda, link do post) e foi ignorado");
  const facetPlan = p.facets !== undefined ? planFacets(db, p.facets) : [];
  db.transaction(() => {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const k of TEXT_FIELDS) {
      if (typeof (p as any)[k] === "string") { sets.push(`${k} = ?`); vals.push((p as any)[k]); }
    }
    if (typeof p.caption === "string") {
      sets.push("hashtags = ?", "cta_keyword = ?");
      vals.push(extractHashtags(p.caption), extractCta(p.caption));
    }
    if (p.creator_guess !== undefined) {
      const g = typeof p.creator_guess === "string" ? p.creator_guess.trim().replace(/^@/, "").slice(0, 100) : "";
      sets.push("creator_guess = ?"); vals.push(g || null);
    }
    if (p.favorite !== undefined) { sets.push("favorite = ?"); vals.push(p.favorite ? 1 : 0); }
    if (p.formato_id !== undefined) {
      if (p.formato_id !== null && !db.query("SELECT 1 FROM formatos WHERE id = ?").get(p.formato_id)) throw new HttpError(400, "Formato inválido");
      sets.push("formato_id = ?");
      vals.push(p.formato_id);
    }
    if (p.published_at !== undefined) {
      if (p.published_at && Number.isNaN(Date.parse(p.published_at))) throw new HttpError(400, "Data de publicação inválida");
      sets.push("published_at = ?"); vals.push(p.published_at || null);
    }
    sets.push("updated_at = ?"); vals.push(now());
    db.run(`UPDATE refs SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);

    const replace = (table: string, col: string, list: number[] | undefined) => {
      if (!list) return;
      db.run(`DELETE FROM ${table} WHERE ref_id = ?`, [id]);
      const ins = db.prepare(`INSERT OR IGNORE INTO ${table} (ref_id, ${col}) VALUES (?, ?)`);
      for (const v of ids(list)) ins.run(id, v);
    };
    replace("ref_categories", "category_id", p.categories);
    replace("ref_clients", "client_id", p.clients);
    replace("ref_projects", "project_id", p.projects);
    if (p.tags) {
      const tagIds = p.tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean).map((name) => {
        db.run("INSERT OR IGNORE INTO tags (name) VALUES (?)", [name]);
        return (db.query("SELECT id FROM tags WHERE name = ?").get(name) as any).id as number;
      });
      replace("ref_tags", "tag_id", tagIds);
    }
    for (const { facetId, values } of facetPlan) {
      db.run("DELETE FROM ref_facet_values WHERE ref_id = ? AND value_id IN (SELECT id FROM facet_values WHERE facet_id = ?)", [id, facetId]);
      const ins = db.prepare("INSERT OR IGNORE INTO ref_facet_values (ref_id, value_id, source) VALUES (?, ?, 'manual')");
      for (const v of values) ins.run(id, v);
    }
  })();
  if (p.categories || p.username !== undefined) syncFileName(ctx, id);
  const out: RefPatchResult = getRef(ctx, id)!;
  if (warnings.length) out.warnings = warnings;
  return out;
}

/** Valida { eixo: [valueIds] } antes de gravar: eixo existe, valor pertence ao eixo, cardinalidade "one" aceita no máximo 1. */
function planFacets(db: Database, input: unknown): { facetId: number; values: number[] }[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "facets deve ser { eixo: [ids] }");
  return Object.entries(input as Record<string, unknown>).map(([key, list]) => {
    const f = db.query("SELECT id, cardinality, label FROM facets WHERE key = ?").get(key) as any;
    if (!f) throw new HttpError(400, `Faceta desconhecida: ${key}`);
    const values = [...new Set(ids(list))];
    if (f.cardinality === "one" && values.length > 1) throw new HttpError(400, `${f.label} aceita um valor só`);
    for (const v of values) {
      if (!db.query("SELECT 1 FROM facet_values WHERE id = ? AND facet_id = ?").get(v, f.id)) throw new HttpError(400, `Valor ${v} não pertence a ${f.label}`);
    }
    return { facetId: f.id as number, values };
  });
}

export function primaryCategory(db: Database, id: string): string | null {
  return (db.query("SELECT c.name FROM ref_categories rc JOIN categories c ON c.id = rc.category_id WHERE rc.ref_id = ? ORDER BY rc.rowid LIMIT 1").get(id) as any)?.name ?? null;
}

/** Renomeia o arquivo para refletir usuário/categoria atuais. O ID nunca muda. */
export function syncFileName({ db, root }: Ctx, id: string) {
  const r = db.query("SELECT video_path, username FROM refs WHERE id = ?").get(id) as any;
  if (!r?.video_path) return;
  const next = join(dirname(r.video_path), videoFileName(id, r.username, primaryCategory(db, id)));
  if (next === r.video_path) return;
  const from = safeJoin(root, r.video_path), to = safeJoin(root, next);
  if (!from || !to || !existsSync(from) || existsSync(to)) return;
  renameSync(from, to);
  db.run("UPDATE refs SET video_path = ? WHERE id = ?", [next, id]);
}

/** Recalcula a palavra-chave salva. O painel lê a legenda ao vivo; o filtro lê esta coluna. */
export function refreshCtaKeywords(db: Database) {
  const rows = db.query("SELECT id, caption, cta_keyword FROM refs").all() as any[];
  const upd = db.prepare("UPDATE refs SET cta_keyword = ? WHERE id = ?");
  db.transaction(() => {
    for (const r of rows) {
      const next = extractCta(r.caption);
      if (next !== r.cta_keyword) upd.run(next, r.id);
    }
  })();
}

export function deleteRef({ db, root }: Ctx, id: string) {
  const r = db.query("SELECT video_path, thumb_path, filmstrip_path FROM refs WHERE id = ?").get(id) as any;
  if (!r) throw new HttpError(404, "Referência não encontrada");
  db.run("DELETE FROM refs WHERE id = ?", [id]);
  for (const p of [r.video_path, r.thumb_path, r.filmstrip_path]) {
    const abs = p && safeJoin(root, p);
    if (abs) rmSync(abs, { force: true });
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}
