import { ensureClientSlugs, ensureProfiles, now, profileAtivo } from "./db";
import { funnel, localDay, stageSql } from "./pipeline";
import { duplicateGroups, HttpError, listRefs, type Ctx } from "./refs";
import { extractCtaActions } from "./text";
import { STAGES, type FacetsResponse, type Filters } from "./types";

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const required = (v: unknown, label: string) => {
  const s = str(v, 200);
  if (!s) throw new HttpError(400, `${label} é obrigatório`);
  return s;
};
const HEX = /^#[0-9a-f]{6}$/i;

function unique<T>(fn: () => T, msg: string): T {
  try {
    return fn();
  } catch (e: any) {
    if (String(e?.message).includes("UNIQUE")) throw new HttpError(409, msg);
    throw e;
  }
}

function patchRow(ctx: Ctx, table: string, id: number, body: any, fields: string[]) {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  for (const f of fields) {
    const v = str(body[f]);
    if (v === undefined) continue;
    if (f === "name" && !v) throw new HttpError(400, "Nome é obrigatório");
    if (f === "color" && !HEX.test(v)) throw new HttpError(400, "Cor inválida");
    sets.push(`${f} = ?`);
    vals.push(v);
  }
  if (sets.length) {
    const res = unique(() => ctx.db.run(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]), "Já existe um registro com esse nome");
    if (!res.changes) throw new HttpError(404, "Não encontrado");
  }
}

function remove(ctx: Ctx, table: string, id: number) {
  if (!ctx.db.run(`DELETE FROM ${table} WHERE id = ?`, [id]).changes) throw new HttpError(404, "Não encontrado");
}

// ---------- Clientes ----------

export function listClients({ db }: Ctx) {
  return db.query(`SELECT c.*, p.slug AS profile_slug, p.name AS profile_name, p.tipo AS profile_tipo,
      (SELECT count(*) FROM ref_clients WHERE client_id = c.id) AS ref_count,
      (SELECT count(*) FROM ref_pipeline WHERE client_id = c.id AND etapa <> 'descartada') AS replicacoes,
      (SELECT count(*) FROM projects WHERE client_id = c.id AND status = 'ativo') AS active_projects,
      (SELECT r.thumb_path FROM ref_clients rc JOIN refs r ON r.id = rc.ref_id WHERE rc.client_id = c.id ORDER BY r.imported_at DESC LIMIT 1) AS cover
    FROM clients c LEFT JOIN profiles p ON p.id = c.profile_id ORDER BY c.name`).all().map((c: any) => ({ ...c, ativo: profileAtivo(c.profile_slug ?? c.slug) }));
}

export function getClient(ctx: Ctx, id: number) {
  const c = ctx.db.query(`SELECT c.*, p.slug AS profile_slug, p.name AS profile_name, p.tipo AS profile_tipo
    FROM clients c LEFT JOIN profiles p ON p.id = c.profile_id WHERE c.id = ?`).get(id) as any;
  if (!c) throw new HttpError(404, "Expert não encontrado");
  c.ativo = profileAtivo(c.profile_slug ?? c.slug);
  c.projects = ctx.db.query(`SELECT p.*, (SELECT count(*) FROM ref_projects WHERE project_id = p.id) AS ref_count
    FROM projects p WHERE client_id = ? ORDER BY p.status, p.name`).all(id);
  c.categories = ctx.db.query("SELECT cat.id, cat.name FROM client_categories cc JOIN categories cat ON cat.id = cc.category_id WHERE cc.client_id = ? ORDER BY cat.position").all(id);
  return c;
}

export function createClient(ctx: Ctx, b: any) {
  if (b.profile_slug !== undefined && !ctx.db.query("SELECT 1 FROM profiles WHERE slug = ?").get(String(b.profile_slug ?? ""))) throw new HttpError(400, "Perfil não encontrado");
  const color = str(b.color) || "#EE794E";
  if (!HEX.test(color)) throw new HttpError(400, "Cor inválida");
  const id = unique(() => ctx.db.run("INSERT INTO clients (name, segment, color, notes, avatar, genero, avatar_estilo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [required(b.name, "Nome"), str(b.segment) ?? "", color, str(b.notes, 10000) ?? "", str(b.avatar) ?? "", b.genero === "mulher" ? "mulher" : "homem", b.avatar_estilo === "real" ? "real" : "3d", now()]).lastInsertRowid, "Já existe um expert com esse nome");
  if (Array.isArray(b.categories)) setClientCategories(ctx, Number(id), b.categories);
  // Slug congelado na criação (renomear depois não muda a pasta) + perfil informado, o perfil conhecido ou um próprio.
  ensureClientSlugs(ctx.db);
  if (b.profile_slug !== undefined) setClientProfile(ctx, Number(id), b.profile_slug);
  ensureProfiles(ctx.db);
  return getClient(ctx, Number(id));
}

/** Liga o personagem a um perfil existente (ex.: um terceiro avatar das Mini Chefs da Vovó). */
function setClientProfile(ctx: Ctx, id: number, slug: unknown) {
  const p = ctx.db.query("SELECT id FROM profiles WHERE slug = ?").get(String(slug ?? "")) as any;
  if (!p) throw new HttpError(400, "Perfil não encontrado");
  ctx.db.run("UPDATE clients SET profile_id = ? WHERE id = ?", [p.id, id]);
}

export function updateClient(ctx: Ctx, id: number, b: any) {
  if (b.genero !== undefined && !["homem", "mulher"].includes(b.genero)) throw new HttpError(400, "Gênero inválido");
  if (b.avatar_estilo !== undefined && !["3d", "real"].includes(b.avatar_estilo)) throw new HttpError(400, "Estilo inválido");
  patchRow(ctx, "clients", id, b, ["name", "segment", "color", "notes", "avatar", "genero", "avatar_estilo"]);
  if (b.profile_slug !== undefined) setClientProfile(ctx, id, b.profile_slug);
  if (Array.isArray(b.categories)) setClientCategories(ctx, id, b.categories);
  return getClient(ctx, id);
}

function setClientCategories({ db }: Ctx, id: number, cats: unknown[]) {
  db.transaction(() => {
    db.run("DELETE FROM client_categories WHERE client_id = ?", [id]);
    for (const c of cats) db.run("INSERT OR IGNORE INTO client_categories (client_id, category_id) VALUES (?, ?)", [id, Number(c)]);
  })();
}

export const deleteClient = (ctx: Ctx, id: number) => remove(ctx, "clients", id);

// ---------- Projetos ----------

const PROJECT_STATUS = ["ativo", "pausado", "concluido"];

export function createProject(ctx: Ctx, b: any) {
  const status = str(b.status) || "ativo";
  if (!PROJECT_STATUS.includes(status)) throw new HttpError(400, "Status de projeto inválido");
  if (!ctx.db.query("SELECT 1 FROM clients WHERE id = ?").get(Number(b.client_id))) throw new HttpError(400, "Expert inválido");
  const id = unique(() => ctx.db.run("INSERT INTO projects (client_id, name, status, notes, created_at) VALUES (?, ?, ?, ?, ?)",
    [Number(b.client_id), required(b.name, "Nome"), status, str(b.notes, 10000) ?? "", now()]).lastInsertRowid, "Essa cliente já tem um projeto com esse nome");
  return ctx.db.query("SELECT * FROM projects WHERE id = ?").get(Number(id));
}

export function updateProject(ctx: Ctx, id: number, b: any) {
  if (b.status !== undefined && !PROJECT_STATUS.includes(b.status)) throw new HttpError(400, "Status de projeto inválido");
  patchRow(ctx, "projects", id, b, ["name", "status", "notes"]);
  return ctx.db.query("SELECT * FROM projects WHERE id = ?").get(id);
}

export const deleteProject = (ctx: Ctx, id: number) => remove(ctx, "projects", id);

export function listProjects({ db }: Ctx) {
  return db.query("SELECT p.*, c.name AS client_name FROM projects p JOIN clients c ON c.id = p.client_id ORDER BY c.name, p.name").all();
}

// ---------- Categorias e tags ----------

export function listCategories({ db }: Ctx) {
  return db.query(`SELECT c.*, (SELECT count(*) FROM ref_categories WHERE category_id = c.id) AS ref_count
    FROM categories c ORDER BY c.position, c.name`).all();
}

export function createCategory(ctx: Ctx, b: any) {
  const pos = (ctx.db.query("SELECT coalesce(max(position), -1) + 1 AS p FROM categories").get() as any).p;
  const id = unique(() => ctx.db.run("INSERT INTO categories (name, position) VALUES (?, ?)", [required(b.name, "Nome"), pos]).lastInsertRowid, "Essa categoria já existe");
  return ctx.db.query("SELECT * FROM categories WHERE id = ?").get(Number(id));
}

export function updateCategory(ctx: Ctx, id: number, b: any) {
  patchRow(ctx, "categories", id, b, ["name"]);
  return ctx.db.query("SELECT * FROM categories WHERE id = ?").get(id);
}

export const deleteCategory = (ctx: Ctx, id: number) => remove(ctx, "categories", id);

export function listFormatos({ db }: Ctx) {
  return db.query(`SELECT f.*, (SELECT count(*) FROM refs WHERE formato_id = f.id) AS ref_count
    FROM formatos f ORDER BY f.position, f.name`).all();
}

export function createFormato(ctx: Ctx, b: any) {
  const pos = (ctx.db.query("SELECT coalesce(max(position), -1) + 1 AS p FROM formatos").get() as any).p;
  const id = unique(() => ctx.db.run("INSERT INTO formatos (name, position) VALUES (?, ?)", [required(b.name, "Nome"), pos]).lastInsertRowid, "Esse formato já existe");
  return ctx.db.query("SELECT * FROM formatos WHERE id = ?").get(Number(id));
}

export function listTags({ db }: Ctx) {
  return db.query("SELECT t.*, (SELECT count(*) FROM ref_tags WHERE tag_id = t.id) AS ref_count FROM tags t ORDER BY t.name").all();
}

// ---------- Coleções ----------

export function listCollections(ctx: Ctx) {
  const rows = ctx.db.query("SELECT * FROM collections ORDER BY created_at DESC").all() as any[];
  return rows.map((c) => {
    const refs = listRefs(ctx, { collection: c.id, sort: "recentes" }, 4).items;
    const count = c.kind === "smart" ? listRefs(ctx, { collection: c.id }).total
      : (ctx.db.query("SELECT count(*) n FROM collection_refs WHERE collection_id = ?").get(c.id) as any).n;
    return { ...c, filters: c.filters ? JSON.parse(c.filters) : null, ref_count: count, covers: refs.map((r) => r.thumb_path).filter(Boolean) };
  });
}

export function getCollection(ctx: Ctx, id: number) {
  const c = ctx.db.query("SELECT * FROM collections WHERE id = ?").get(id) as any;
  if (!c) throw new HttpError(404, "Coleção não encontrada");
  return { ...c, filters: c.filters ? JSON.parse(c.filters) : null };
}

export function createCollection(ctx: Ctx, b: any) {
  const kind = b.kind === "smart" ? "smart" : "manual";
  const filters = kind === "smart" ? JSON.stringify(cleanFilters(b.filters ?? {})) : null;
  const id = Number(ctx.db.run("INSERT INTO collections (name, description, kind, filters, created_at) VALUES (?, ?, ?, ?, ?)",
    [required(b.name, "Nome"), str(b.description, 2000) ?? "", kind, filters, now()]).lastInsertRowid);
  if (kind === "manual" && Array.isArray(b.refs)) addToCollection(ctx, id, b.refs);
  return getCollection(ctx, id);
}

export function updateCollection(ctx: Ctx, id: number, b: any) {
  patchRow(ctx, "collections", id, b, ["name", "description"]);
  if (b.filters && getCollection(ctx, id).kind === "smart") {
    ctx.db.run("UPDATE collections SET filters = ? WHERE id = ?", [JSON.stringify(cleanFilters(b.filters)), id]);
  }
  return getCollection(ctx, id);
}

export const deleteCollection = (ctx: Ctx, id: number) => remove(ctx, "collections", id);

export function addToCollection(ctx: Ctx, id: number, refs: string[], removeIt = false) {
  if (getCollection(ctx, id).kind !== "manual") throw new HttpError(400, "Coleções inteligentes são definidas por filtro");
  ctx.db.transaction(() => {
    let pos = (ctx.db.query("SELECT coalesce(max(position), -1) + 1 AS p FROM collection_refs WHERE collection_id = ?").get(id) as any).p;
    for (const r of refs) {
      if (removeIt) ctx.db.run("DELETE FROM collection_refs WHERE collection_id = ? AND ref_id = ?", [id, r]);
      else ctx.db.run("INSERT OR IGNORE INTO collection_refs (collection_id, ref_id, position) VALUES (?, ?, ?)", [id, r, pos++]);
    }
  })();
}

/** Mantém só chaves conhecidas de filtro (o JSON fica salvo no banco). */
export function cleanFilters(f: any): Filters {
  const keys: (keyof Filters)[] = ["q", "clients", "projects", "categories", "tags", "creator", "status", "favorite", "kind", "cta",
    "publishedFrom", "publishedTo", "importedFrom", "importedTo", "minViews", "minLikes", "minComments", "minEngagement", "sort",
    "facets", "stage", "profile", "origem", "sem_criador"];
  const out: any = {};
  for (const k of keys) {
    const v = f?.[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
}

/** Valores existentes para montar os filtros da interface. Valores sem uso só aparecem com `todos` (editor da classificação). */
export function facets({ db }: Ctx, todos = false): FacetsResponse {
  const creators = db.query("SELECT username, max(display_name) AS display_name, count(*) n FROM refs WHERE username IS NOT NULL AND username <> '' GROUP BY username ORDER BY n DESC, username").all() as any[];
  const axes = (db.query("SELECT id, key, label, cardinality FROM facets ORDER BY position, id").all() as any[]).map((f) => {
    const values = (db.query(`SELECT v.id, v.name,
        (SELECT count(DISTINCT x.ref_id) FROM ref_facet_values x JOIN facet_values y ON y.id = x.value_id WHERE y.id = v.id OR y.merged_into = v.id) AS n
      FROM facet_values v WHERE v.facet_id = ? AND v.merged_into IS NULL ORDER BY v.position, v.name`).all(f.id) as any[]).filter((v) => todos || v.n > 0);
    return { key: f.key, label: f.label, cardinality: f.cardinality, values };
  }).filter((f) => todos || f.values.length);
  const stageRows = db.query(`SELECT st AS value, count(*) n FROM (SELECT (${stageSql("r")}) AS st FROM refs r) GROUP BY st`).all(localDay()) as any[];
  const stageN = new Map(stageRows.map((r) => [r.value, r.n]));
  return {
    creators,
    ctas: db.query("SELECT cta_keyword AS keyword, count(*) n FROM refs WHERE cta_keyword IS NOT NULL GROUP BY cta_keyword ORDER BY n DESC").all() as any,
    kind: db.query("SELECT kind AS value, count(*) n FROM refs GROUP BY kind ORDER BY n DESC").all() as any,
    stage: STAGES.map((value) => ({ value, n: stageN.get(value) ?? 0 })).filter((x) => todos || x.n > 0),
    origem: db.query(`SELECT coalesce(origem, CASE WHEN source = 'instagram' THEN 'instagram' ELSE 'upload' END) AS value, count(*) n
      FROM refs GROUP BY value ORDER BY n DESC`).all() as any,
    criador: creators,
    sem_criador: (db.query("SELECT count(*) n FROM refs WHERE username IS NULL OR username = ''").get() as any).n,
    profiles: db.query(`SELECT p.slug, p.name, count(DISTINCT x.ref_id) n FROM profiles p JOIN clients c ON c.profile_id = p.id
      JOIN (SELECT ref_id, client_id FROM ref_clients UNION SELECT ref_id, client_id FROM ref_pipeline WHERE etapa <> 'descartada') x ON x.client_id = c.id
      GROUP BY p.id ORDER BY n DESC, p.name`).all() as any,
    facets: axes,
  };
}

/** Novo valor num eixo de faceta (ex.: um gancho que ainda não existe). */
export function createFacetValue(ctx: Ctx, key: string, b: any) {
  const f = ctx.db.query("SELECT id FROM facets WHERE key = ?").get(key) as any;
  if (!f) throw new HttpError(404, "Faceta não encontrada");
  const pos = (ctx.db.query("SELECT coalesce(max(position), -1) + 1 AS p FROM facet_values WHERE facet_id = ?").get(f.id) as any).p;
  const id = unique(() => ctx.db.run("INSERT INTO facet_values (facet_id, name, position) VALUES (?, ?, ?)", [f.id, required(b?.name, "Nome"), pos]).lastInsertRowid, "Esse valor já existe nesta faceta");
  return ctx.db.query("SELECT id, name, position FROM facet_values WHERE id = ?").get(Number(id));
}

// ---------- Dashboard ----------

export function stats(ctx: Ctx) {
  const { db } = ctx;
  const one = (sql: string) => (db.query(sql).get() as any).n as number;
  const pick = (f: Filters, n: number) => listRefs(ctx, f, n).items;
  const withViews = one(`SELECT count(*) n FROM refs r WHERE EXISTS (SELECT 1 FROM metric_snapshots WHERE ref_id = r.id AND views IS NOT NULL)`);
  return {
    total: one("SELECT count(*) n FROM refs"),
    local_videos: one("SELECT count(*) n FROM refs WHERE video_path IS NOT NULL"),
    clients: one("SELECT count(*) n FROM clients"),
    favorites_count: one("SELECT count(*) n FROM refs WHERE favorite = 1"),
    storage_bytes: one("SELECT coalesce(sum(file_size), 0) n FROM refs"),
    // storage_bytes ≠ /api/storage: este é só a soma dos vídeos das referências; o outro mede a pasta inteira da biblioteca.
    storage: { bytes: one("SELECT coalesce(sum(file_size), 0) n FROM refs"), label: "Vídeos das referências (soma dos arquivos)" },
    funnel: funnel(ctx),
    pendencias: {
      sem_formato: one(`SELECT count(*) n FROM refs r WHERE NOT EXISTS (SELECT 1 FROM ref_facet_values x JOIN facet_values v ON v.id = x.value_id JOIN facets f ON f.id = v.facet_id WHERE x.ref_id = r.id AND f.key = 'formato')`),
      sem_objetivo: one(`SELECT count(*) n FROM refs r WHERE NOT EXISTS (SELECT 1 FROM ref_facet_values x JOIN facet_values v ON v.id = x.value_id JOIN facets f ON f.id = v.facet_id WHERE x.ref_id = r.id AND f.key = 'objetivo')`),
      sem_criador: one("SELECT count(*) n FROM refs WHERE username IS NULL OR username = ''"),
      duplicados: duplicateGroups(ctx).length,
    },
    by_status: db.query("SELECT status, count(*) n FROM refs GROUP BY status").all(),
    top_categories: db.query(`SELECT c.id, c.name, count(*) n FROM ref_categories rc JOIN categories c ON c.id = rc.category_id
      GROUP BY c.id ORDER BY n DESC, c.position LIMIT 8`).all(),
    by_client: db.query(`SELECT c.id, c.name, c.color, count(rc.ref_id) n FROM clients c LEFT JOIN ref_clients rc ON rc.client_id = c.id
      GROUP BY c.id ORDER BY n DESC, c.name`).all(),
    unassigned: one("SELECT count(*) n FROM refs r WHERE NOT EXISTS (SELECT 1 FROM ref_clients WHERE ref_id = r.id)"),
    recent: pick({ sort: "recentes" }, 6),
    favorites: pick({ favorite: true, sort: "recentes" }, 6),
    with_views: withViews,
    top_viewed: withViews ? pick({ minViews: 0, sort: "views" }, 5) : [],
    top_liked: pick({ minLikes: 0, sort: "likes" }, 5),
    last_import: (db.query("SELECT max(updated_at) n FROM import_items").get() as any).n as string | null,
    cta_map: (db.query("SELECT id, username, caption FROM refs ORDER BY id").all() as any[]).map((r) => ({
      id: r.id, username: r.username, actions: extractCtaActions(r.caption),
    })),
  };
}

// ---------- Configurações ----------

/** Agenda: meta de posts por dia em cada perfil, horários (o 5º só entra quando um dos outros está ocupado) e liga/desliga. */
export const DEFAULT_SETTINGS = { cookies_browser: "", import_delay_ms: "4000", agenda_perfis: "{}", meta_posts_dia: "4", horarios_posts: "09:00,12:00,15:00,18:00,21:00", agenda_auto: "1" };
export type Settings = typeof DEFAULT_SETTINGS;
const BROWSERS = ["", "chrome", "safari", "firefox", "brave", "edge", "arc"];

export function getSettings({ db }: Ctx): Settings {
  const out = { ...DEFAULT_SETTINGS };
  for (const r of db.query("SELECT key, value FROM settings").all() as any[]) if (r.key in out) (out as any)[r.key] = r.value;
  return out;
}

export function updateSettings(ctx: Ctx, b: any): Settings {
  if (b.cookies_browser !== undefined && !BROWSERS.includes(b.cookies_browser)) throw new HttpError(400, "Navegador não suportado");
  if (b.import_delay_ms !== undefined) {
    const n = Number(b.import_delay_ms);
    if (!Number.isInteger(n) || n < 0 || n > 120000) throw new HttpError(400, "Intervalo deve ser entre 0 e 120000 ms");
  }
  if (b.meta_posts_dia !== undefined) {
    const n = Number(b.meta_posts_dia);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new HttpError(400, "Meta deve ser de 1 a 12 posts por dia");
  }
  if (b.horarios_posts !== undefined) {
    const hs = String(b.horarios_posts).split(/[,\s]+/).filter(Boolean);
    if (!hs.length || hs.some((h) => !/^([01]?\d|2[0-3]):[0-5]\d$/.test(h))) throw new HttpError(400, "Horários no formato 09:00, 12:00…");
    b.horarios_posts = hs.map((h) => h.padStart(5, "0")).sort().join(",");
  }
  if (b.agenda_perfis !== undefined) {
    let perfis: any;
    try { perfis = typeof b.agenda_perfis === "string" ? JSON.parse(b.agenda_perfis) : b.agenda_perfis; } catch { throw new HttpError(400, "Agenda por perfil inválida"); }
    if (!perfis || typeof perfis !== "object" || Array.isArray(perfis)) throw new HttpError(400, "Agenda por perfil inválida");
    for (const c of Object.values(perfis) as any[]) {
      if (!c || !Number.isInteger(c.meta) || c.meta < 1 || c.meta > 12 || !Array.isArray(c.horarios) || c.horarios.length < c.meta || c.horarios.some((h:any) => typeof h !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) || new Set(c.horarios).size !== c.horarios.length) throw new HttpError(400, "Meta/horários do perfil inválidos");
      if (c.horariosIA !== undefined && (!Array.isArray(c.horariosIA) || c.horariosIA.some((h:any) => !c.horarios.includes(h)))) throw new HttpError(400, "Horários IA inválidos");
    }
    b.agenda_perfis = JSON.stringify(perfis);
  }
  if (b.agenda_auto !== undefined) b.agenda_auto = b.agenda_auto === true || b.agenda_auto === "1" ? "1" : "0";
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (b[k] !== undefined) ctx.db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [k, String(b[k])]);
  }
  return getSettings(ctx);
}
