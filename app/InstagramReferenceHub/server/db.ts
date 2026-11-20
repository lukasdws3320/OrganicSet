import { Database } from "bun:sqlite";
import { join } from "node:path";
import { seedAngulos } from "./angulos";
import { expertSlug } from "./text";
import type { ProfileTipo } from "./types";

export const DB_FILE = join("database", "irh.sqlite");

export const INITIAL_CATEGORIES = [
  "Storytelling", "Ganchos virais", "Vendas", "Autoridade", "Conteúdo educativo",
  "Bastidores", "Humor", "Trends", "Lifestyle", "Prova social",
  "Depoimentos", "Edição criativa", "Transições", "Roteiros", "Conteúdo emocional",
];

const ANALYSIS = "hook, script_structure, editing_technique, save_reason, adaptation, derived_ideas";

type Migration = string | ((db: Database) => void);

/** Migrações versionadas: só se acrescenta ao fim desta lista. Da 7 em diante, só aditivas (sem DROP/DELETE/rename). */
const MIGRATIONS: Migration[] = [
  `
  CREATE TABLE refs (
    id TEXT PRIMARY KEY,
    seq_month TEXT NOT NULL,
    seq INTEGER NOT NULL,
    shortcode TEXT UNIQUE,
    url TEXT,
    kind TEXT NOT NULL DEFAULT 'video' CHECK (kind IN ('video','imagem','carrossel')),
    source TEXT NOT NULL DEFAULT 'instagram' CHECK (source IN ('instagram','manual')),
    username TEXT,
    display_name TEXT,
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT NOT NULL DEFAULT '',
    cta_keyword TEXT,
    published_at TEXT,
    imported_at TEXT NOT NULL,
    duration REAL, width INTEGER, height INTEGER,
    video_path TEXT, thumb_path TEXT, filmstrip_path TEXT,
    file_hash TEXT, file_size INTEGER,
    cuts INTEGER, avg_shot REAL,
    status TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','producao','usada')),
    favorite INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    hook TEXT NOT NULL DEFAULT '', script_structure TEXT NOT NULL DEFAULT '',
    editing_technique TEXT NOT NULL DEFAULT '', save_reason TEXT NOT NULL DEFAULT '',
    adaptation TEXT NOT NULL DEFAULT '', derived_ideas TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE (seq_month, seq)
  );
  CREATE INDEX refs_hash ON refs(file_hash);
  CREATE INDEX refs_username ON refs(username);

  CREATE TABLE metric_snapshots (
    id INTEGER PRIMARY KEY,
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    views INTEGER, likes INTEGER, comments INTEGER,
    collected_at TEXT NOT NULL,
    source TEXT NOT NULL
  );
  CREATE INDEX metric_ref ON metric_snapshots(ref_id, collected_at);

  CREATE TABLE clients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    segment TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#EE794E',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado','concluido')),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE (client_id, name)
  );
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);

  CREATE TABLE ref_clients (ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, PRIMARY KEY (ref_id, client_id));
  CREATE TABLE ref_projects (ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, PRIMARY KEY (ref_id, project_id));
  CREATE TABLE ref_categories (ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, PRIMARY KEY (ref_id, category_id));
  CREATE TABLE ref_tags (ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE, tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY (ref_id, tag_id));
  CREATE TABLE client_categories (client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE, category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE, PRIMARY KEY (client_id, category_id));
  CREATE INDEX ref_clients_c ON ref_clients(client_id);
  CREATE INDEX ref_categories_c ON ref_categories(category_id);

  CREATE TABLE collections (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','smart')),
    filters TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE collection_refs (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, ref_id)
  );

  CREATE TABLE markers (
    id INTEGER PRIMARY KEY,
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    t REAL NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE import_jobs (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE import_items (
    id INTEGER PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    shortcode TEXT,
    status TEXT NOT NULL CHECK (status IN ('pendente','baixando','ok','duplicado','erro')),
    error TEXT,
    ref_id TEXT REFERENCES refs(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX import_items_job ON import_items(job_id);

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE VIRTUAL TABLE refs_fts USING fts5(
    ref_id UNINDEXED, caption, hashtags, username, display_name, notes, analysis,
    tokenize = "unicode61 remove_diacritics 2"
  );
  CREATE TRIGGER refs_ai AFTER INSERT ON refs BEGIN
    INSERT INTO refs_fts (ref_id, caption, hashtags, username, display_name, notes, analysis)
    VALUES (new.id, new.caption, new.hashtags, new.username, new.display_name, new.notes,
      concat_ws(' ', new.hook, new.script_structure, new.editing_technique, new.save_reason, new.adaptation, new.derived_ideas, new.cta_keyword));
  END;
  CREATE TRIGGER refs_ad AFTER DELETE ON refs BEGIN
    DELETE FROM refs_fts WHERE ref_id = old.id;
  END;
  CREATE TRIGGER refs_au AFTER UPDATE OF caption, hashtags, username, display_name, notes, cta_keyword, ${ANALYSIS} ON refs BEGIN
    DELETE FROM refs_fts WHERE ref_id = old.id;
    INSERT INTO refs_fts (ref_id, caption, hashtags, username, display_name, notes, analysis)
    VALUES (new.id, new.caption, new.hashtags, new.username, new.display_name, new.notes,
      concat_ws(' ', new.hook, new.script_structure, new.editing_technique, new.save_reason, new.adaptation, new.derived_ideas, new.cta_keyword));
  END;
  `,
  // 2: atribuições aplicadas aos itens de um lote (clientes, categorias, coleção, nota)
  `ALTER TABLE import_jobs ADD COLUMN assign TEXT;`,
  // 3: fala transcrita. Categoria só pode ser marcada a partir daqui, nunca da capa.
  `ALTER TABLE refs ADD COLUMN transcript TEXT NOT NULL DEFAULT '';`,
  // 4: status de execução da replicação (por STILL/SHOT); o conteúdo vive em library/replicacoes/<REF>/.
  `CREATE TABLE replicacao_status (
    ref TEXT NOT NULL,
    item TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pendente', 'feito')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (ref, item)
  );`,
  // 5: "cliente" passa a ser EXPERT (inclusive operações próprias). Avatar = nome da contact sheet (contactsheet<Nome><NN>).
  //    Replicação passa a ser por REF × expert: status antigo (chave = REF) vai pro Bruno, único expert das replicações v1.
  `ALTER TABLE clients ADD COLUMN avatar TEXT NOT NULL DEFAULT '';
  ALTER TABLE clients ADD COLUMN genero TEXT NOT NULL DEFAULT 'homem';
  ALTER TABLE clients ADD COLUMN avatar_estilo TEXT NOT NULL DEFAULT '3d';
  UPDATE replicacao_status SET ref = ref || '--bruno-goytacazes' WHERE ref NOT LIKE '%--%';`,
  // 6: formato é um eixo próprio (um por referência). Não é categoria de conteúdo.
  `CREATE TABLE formatos (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    position INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE refs ADD COLUMN formato_id INTEGER REFERENCES formatos(id) ON DELETE SET NULL;`,
  // 7: mídias do post (carrossel com todos os slides). Posição 0 = mídia atual da referência (compatível com video_path/thumb_path).
  //    path NULL = slide conhecido e não baixado (o importador registra o total real sem inventar arquivo).
  `CREATE TABLE ref_media (
    id INTEGER PRIMARY KEY,
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('video','imagem')),
    path TEXT, thumb_path TEXT,
    width INTEGER, height INTEGER, duration REAL, file_hash TEXT, file_size INTEGER,
    UNIQUE (ref_id, position)
  );
  INSERT INTO ref_media (ref_id, position, type, path, thumb_path, width, height, duration, file_hash, file_size)
    SELECT id, 0, CASE WHEN video_path IS NOT NULL THEN 'video' ELSE 'imagem' END,
           coalesce(video_path, thumb_path), thumb_path, width, height, duration, file_hash, file_size
    FROM refs WHERE coalesce(video_path, thumb_path) IS NOT NULL;
  ALTER TABLE refs ADD COLUMN media_count INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE refs ADD COLUMN product_type TEXT;`,
  // 8: proveniência e identidade legada (sai de tags/display_name/notes). Só cópia: tags e display_name continuam iguais.
  `ALTER TABLE refs ADD COLUMN origem TEXT;
  ALTER TABLE refs ADD COLUMN legacy_id TEXT;
  ALTER TABLE refs ADD COLUMN creator_guess TEXT;
  UPDATE refs SET origem = CASE
    WHEN EXISTS (SELECT 1 FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = refs.id AND t.name = 'op-antiga') THEN 'op001'
    WHEN EXISTS (SELECT 1 FROM ref_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.ref_id = refs.id AND t.name = 'mapeamento') THEN 'mapeamento'
    WHEN source = 'instagram' THEN 'instagram'
    ELSE 'upload' END;
  UPDATE refs SET legacy_id = substr(display_name, 1, 7) WHERE display_name GLOB 'REF[0-9][0-9][0-9][0-9] ·*';
  CREATE INDEX refs_origem ON refs(origem);`,
  // 9: facetas genéricas (um eixo por linha). formatos/categories antigos ficam intactos (legado) e são copiados com source='migracao'.
  (db) => {
    db.exec(`CREATE TABLE facets (
      id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      cardinality TEXT NOT NULL CHECK (cardinality IN ('one','many')), position INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE facet_values (
      id INTEGER PRIMARY KEY, facet_id INTEGER NOT NULL REFERENCES facets(id) ON DELETE CASCADE,
      name TEXT NOT NULL COLLATE NOCASE, position INTEGER NOT NULL DEFAULT 0,
      merged_into INTEGER REFERENCES facet_values(id), UNIQUE (facet_id, name));
    CREATE TABLE ref_facet_values (
      ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
      value_id INTEGER NOT NULL REFERENCES facet_values(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','migracao')),
      PRIMARY KEY (ref_id, value_id));
    CREATE INDEX ref_facet_values_v ON ref_facet_values(value_id);`);
    const insF = db.prepare("INSERT INTO facets (key, label, cardinality, position) VALUES (?, ?, ?, ?)");
    const insV = db.prepare("INSERT INTO facet_values (facet_id, name, position) VALUES (?, ?, ?)");
    FACET_SEED.forEach((f, i) => {
      const fid = Number(insF.run(f.key, f.label, f.cardinality, i).lastInsertRowid);
      f.values.forEach((v, p) => insV.run(fid, v, p));
    });
    const valueId = (key: string, name: string) =>
      (db.query("SELECT v.id FROM facet_values v JOIN facets f ON f.id = v.facet_id WHERE f.key = ? AND v.name = ?").get(key, name) as any)?.id as number | undefined;
    const link = db.prepare("INSERT OR IGNORE INTO ref_facet_values (ref_id, value_id, source) VALUES (?, ?, 'migracao')");
    const apply = (refIds: string[], pairs: [string, string][]) => {
      for (const [key, name] of pairs) {
        const vid = valueId(key, name);
        if (vid) for (const r of refIds) link.run(r, vid);
      }
    };
    for (const f of db.query("SELECT id, name FROM formatos").all() as { id: number; name: string }[]) {
      const pairs = FORMATO_DE_PARA[f.name.toLowerCase()];
      if (!pairs) continue;
      apply((db.query("SELECT id FROM refs WHERE formato_id = ?").all(f.id) as { id: string }[]).map((r) => r.id), pairs);
    }
    for (const c of db.query("SELECT id, name FROM categories").all() as { id: number; name: string }[]) {
      const pairs = CATEGORIA_DE_PARA[c.name.toLowerCase()];
      if (!pairs) continue;
      apply((db.query("SELECT ref_id AS id FROM ref_categories WHERE category_id = ?").all(c.id) as { id: string }[]).map((r) => r.id), pairs);
    }
    // "Expert/Talking CarlKramer" era nome de criador dentro do formato: vira suposição de criador (marcada como "?"), sem tocar em username.
    db.run(`UPDATE refs SET creator_guess = 'CarlKramer' WHERE creator_guess IS NULL AND username IS NULL
      AND formato_id IN (SELECT id FROM formatos WHERE name IN ('Expert CarlKramer', 'Talking CarlKramer') COLLATE NOCASE)`);
  },
  // 10: perfil (conta/negócio) separado de personagem (clients). clients.slug congela o slug das pastas existentes.
  //     clients.name e as pastas library/replicacoes/<REF>/<slug> NÃO mudam.
  (db) => {
    db.exec(`CREATE TABLE profiles (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      tipo TEXT NOT NULL DEFAULT 'expert_parceiro' CHECK (tipo IN ('cliente_aw','expert_parceiro','operacao_propria_dr')),
      instagram TEXT, vault_path TEXT, painel_slug TEXT,
      aliases TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL);
    ALTER TABLE clients ADD COLUMN profile_id INTEGER REFERENCES profiles(id) ON DELETE SET NULL;
    ALTER TABLE clients ADD COLUMN slug TEXT;
    CREATE UNIQUE INDEX clients_slug ON clients(slug) WHERE slug IS NOT NULL;`);
    ensureClientSlugs(db);
    ensureProfiles(db);
  },
  // 11: ciclo por REF × personagem, materializado a partir de library/replicacoes (syncPipeline) e com histórico.
  `CREATE TABLE ref_pipeline (
    ref_id TEXT NOT NULL REFERENCES refs(id) ON DELETE CASCADE,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    etapa TEXT NOT NULL CHECK (etapa IN ('selecionada','analise','prompts','gerando','edicao','pronto','agendado','postado','descartada')),
    modo TEXT CHECK (modo IN ('clonagem','modelagem')),
    formato_replicacao TEXT,
    clips INTEGER NOT NULL DEFAULT 0, clips_total INTEGER NOT NULL DEFAULT 0, editado INTEGER NOT NULL DEFAULT 0,
    post_url TEXT, postado_em TEXT, registrado_em TEXT, agendado_para TEXT, agendado_dia TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (ref_id, client_id));
  CREATE INDEX ref_pipeline_c ON ref_pipeline(client_id);
  CREATE TABLE ref_pipeline_events (
    id INTEGER PRIMARY KEY, ref_id TEXT NOT NULL, client_id INTEGER NOT NULL,
    de TEXT, para TEXT NOT NULL, origem TEXT NOT NULL, detalhe TEXT, at TEXT NOT NULL);
  CREATE INDEX ref_pipeline_events_r ON ref_pipeline_events(ref_id, client_id, at);`,
  // 12: eixo Ângulo (vários por referência) + análise automática por parte (hook/corpo) em JSON.
  (db) => {
    db.exec("ALTER TABLE refs ADD COLUMN angulo_analise TEXT;");
    seedAngulos(db);
  },
  // 13: tarefas da operação inteira (aba Tarefas + scripts/tarefa.ts). Uma linha = uma ação a executar.
  `CREATE TABLE tarefas (
    id INTEGER PRIMARY KEY,
    titulo TEXT NOT NULL,
    frente TEXT NOT NULL DEFAULT 'Geral',
    status TEXT NOT NULL DEFAULT 'a_fazer' CHECK (status IN ('a_fazer','fazendo','esperando','feito')),
    quem TEXT NOT NULL DEFAULT 'Matheus',
    prazo TEXT,
    urgente INTEGER NOT NULL DEFAULT 0,
    nota TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '',
    origem TEXT NOT NULL DEFAULT '',
    passos TEXT NOT NULL DEFAULT '[]',
    criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, feito_em TEXT);
  CREATE INDEX tarefas_status ON tarefas(status, prazo);`,
  // 14: horário da tarefa no dia (HH:MM), pra dividir o dia em blocos.
  `ALTER TABLE tarefas ADD COLUMN hora TEXT;`,
  // 15: contexto da tarefa (qual a entrega, por que importa, trecho da fonte, de quem depende, links, histórico, como encerrou).
  `ALTER TABLE tarefas ADD COLUMN entrega TEXT NOT NULL DEFAULT '';
  ALTER TABLE tarefas ADD COLUMN contexto TEXT NOT NULL DEFAULT '';
  ALTER TABLE tarefas ADD COLUMN trecho TEXT NOT NULL DEFAULT '';
  ALTER TABLE tarefas ADD COLUMN depende TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tarefas ADD COLUMN links TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tarefas ADD COLUMN historico TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE tarefas ADD COLUMN desfecho TEXT NOT NULL DEFAULT '';`,
];

/** Eixos de classificação (SPEC §5.3): cada faceta responde a uma pergunta só. */
export const FACET_SEED: { key: string; label: string; cardinality: "one" | "many"; values: string[] }[] = [
  { key: "formato", label: "Formato", cardinality: "one", values: ["Falando pra câmera", "React", "React + animação", "Podcast", "Receita passo a passo", "Personagens falantes", "Esqueleto/anatomia"] },
  { key: "estilo", label: "Estilo visual", cardinality: "one", values: ["Pixar/3D", "Real", "Real→3D", "Ilustração"] },
  { key: "objetivo", label: "Objetivo", cardinality: "one", values: ["Alcance", "Autoridade", "Educar", "Prova social", "Vender", "Captação (comente X)"] },
  { key: "gancho", label: "Gancho", cardinality: "many", values: ["Mito×verdade", "Lista/3 ingredientes", "Antes/depois", "Pergunta", "Erro comum", "Série"] },
  { key: "nicho", label: "Nicho", cardinality: "many", values: ["Receitas fit", "Receitas infantis", "Emagrecimento", "Saúde natural", "Família/humor"] },
];

/** De-para dos formatos antigos (chave em minúsculas) → valores de faceta. */
const FORMATO_DE_PARA: Record<string, [string, string][]> = {
  "pixar style": [["estilo", "Pixar/3D"]],
  "pixar receitinha": [["estilo", "Pixar/3D"], ["formato", "Receita passo a passo"]],
  "pixar ingredientes": [["estilo", "Pixar/3D"], ["formato", "Personagens falantes"]],
  "pixar elementos": [["estilo", "Pixar/3D"], ["formato", "Personagens falantes"]],
  "pixar esqueleto": [["estilo", "Pixar/3D"], ["formato", "Esqueleto/anatomia"]],
  "react": [["formato", "React"]],
  "react + animação": [["formato", "React + animação"]],
  "frontal talking": [["formato", "Falando pra câmera"]],
  "podcast": [["formato", "Podcast"]],
  "expert carlkramer": [["formato", "Falando pra câmera"]],
  "talking carlkramer": [["formato", "Falando pra câmera"]],
};

/** De-para das categorias antigas → objetivo/nicho. As demais estavam vazias e ficam só no legado. */
const CATEGORIA_DE_PARA: Record<string, [string, string][]> = {
  "receitas": [["nicho", "Receitas fit"]],
  "vendas": [["objetivo", "Vender"]],
  "conteúdo educativo": [["objetivo", "Educar"]],
  "autoridade": [["objetivo", "Autoridade"]],
  "prova social": [["objetivo", "Prova social"]],
  "depoimentos": [["objetivo", "Prova social"]],
};


/** Perfis conhecidos: o slug do perfil é o do vault/painel; os aliases são os slugs antigos do Hub. O @ do Instagram nunca é fixado aqui (vem da ficha).
 *  `name` e `nomes` (personagem por slug) são o nome ATUAL: ao ligar, o Hub alinha o banco a eles. Slugs nunca mudam (são as pastas das replicações). */
function carregarPerfis(): any[] {
  // Pasta do aluno: os perfis vêm de experts/perfis.json (IRH_PERFIS), não de uma lista fixa no código.
  try {
    const { readFileSync } = require("node:fs"), { join } = require("node:path");
    const f = process.env.IRH_PERFIS || join(process.env.IRH_VAULT || join(import.meta.dir, "../../.."), "experts/perfis.json");
    const lista = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(lista) ? lista.map((p: any) => ({ aliases: [], painel_slug: null, nomes: {}, tipo: "operacao_propria_dr", ...p })) : [];
  } catch { return []; }
}
export const KNOWN_PROFILES: { slug: string; name: string; tipo: ProfileTipo; aliases: string[]; vault_path: string; painel_slug: string | null; clients: string[]; nomes: Record<string, string>; ativo?: boolean }[] = carregarPerfis();

/** Congela clients.slug = slug do nome (formato histórico das pastas). Só preenche quem está vazio; nunca muda um slug já gravado. */
export function ensureClientSlugs(db: Database) {
  const taken = new Set((db.query("SELECT slug FROM clients WHERE slug IS NOT NULL").all() as { slug: string }[]).map((r) => r.slug));
  for (const c of db.query("SELECT id, name FROM clients WHERE slug IS NULL ORDER BY id").all() as { id: number; name: string }[]) {
    const base = expertSlug(c.name) || `expert-${c.id}`;
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    taken.add(slug);
    db.run("UPDATE clients SET slug = ? WHERE id = ?", [slug, c.id]);
  }
}

/** Todo personagem (client) pertence a um perfil. Conhecidos vão para o perfil certo; os demais ganham um perfil próprio com o mesmo slug. */
export function ensureProfiles(db: Database) {
  const orphans = db.query("SELECT id, name, slug FROM clients WHERE profile_id IS NULL ORDER BY id").all() as { id: number; name: string; slug: string }[];
  for (const c of orphans) {
    const known = KNOWN_PROFILES.find((k) => k.clients.includes(c.slug));
    const slug = known?.slug ?? c.slug;
    let p = db.query("SELECT id FROM profiles WHERE slug = ?").get(slug) as { id: number } | null;
    if (!p) {
      const pid = db.run("INSERT INTO profiles (slug, name, tipo, vault_path, painel_slug, aliases, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [slug, known?.name ?? c.name, known?.tipo ?? "expert_parceiro", known?.vault_path ?? null, known?.painel_slug ?? null, JSON.stringify(known?.aliases ?? []), now()]).lastInsertRowid;
      p = { id: Number(pid) };
    }
    db.run("UPDATE clients SET profile_id = ? WHERE id = ?", [p.id, c.id]);
  }
  // Pasta do perfil no vault muda de lugar às vezes (ex.: _dr → experts/02_experts-ia em 28/10): a constante manda.
  for (const k of KNOWN_PROFILES) db.run("UPDATE profiles SET vault_path = ? WHERE slug = ? AND vault_path IS NOT ?", [k.vault_path, k.slug, k.vault_path]);
  // Perfil criado pela UI antes de entrar na constante nasce como expert_parceiro: a constante corrige o tipo.
  for (const k of KNOWN_PROFILES) db.run("UPDATE profiles SET tipo = ? WHERE slug = ? AND tipo IS NOT ?", [k.tipo, k.slug, k.tipo]);
  // Nome também: perfil renomeado (ex.: Cozinheiras → Mini Chefs da Vovó) não pode ficar com o nome velho no Hub.
  for (const k of KNOWN_PROFILES) {
    db.run("UPDATE profiles SET name = ? WHERE slug = ? AND name IS NOT ?", [k.name, k.slug, k.name]);
    for (const [slug, nome] of Object.entries(k.nomes)) db.run("UPDATE clients SET name = ? WHERE slug = ? AND name IS NOT ?", [nome, slug, nome]);
  }
}

/** `upTo` só existe para testar migração a partir de um banco antigo; o servidor sempre migra tudo. */
export function openDb(root: string, opts: { upTo?: number } = {}): Database {
  const db = new Database(join(root, DB_FILE), { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db, opts.upTo);
  return db;
}

export const MIGRATION_COUNT = MIGRATIONS.length;

function migrate(db: Database, upTo = MIGRATIONS.length) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(db.query("SELECT version FROM schema_migrations").all().map((r: any) => r.version as number));
  MIGRATIONS.forEach((sql, i) => {
    const v = i + 1;
    if (done.has(v) || v > upTo) return;
    db.transaction(() => {
      if (typeof sql === "string") db.exec(sql);
      else sql(db);
      if (v === 1) {
        const ins = db.prepare("INSERT INTO categories (name, position) VALUES (?, ?)");
        INITIAL_CATEGORIES.forEach((n, p) => ins.run(n, p));
      }
      db.run("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", [v, now()]);
    })();
  });
}

export const now = () => new Date().toISOString();

/** Estado cadastral único; inativos conservam IDs, arquivos e histórico. */
export function profileAtivo(slug: string | null | undefined) {
  return KNOWN_PROFILES.find(p => p.slug === slug || p.clients.includes(slug ?? "") || p.aliases.includes(slug ?? ""))?.ativo !== false;
}
