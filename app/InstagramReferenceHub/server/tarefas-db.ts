// Fonte canônica das tarefas: SQLite próprio, fora da interface (registro em <vault>/_central/_brain/fontes.json, id "tarefas").
// Este módulo é leve de propósito: só bun:sqlite e node:*. O CLI (scripts/tarefas.ts) e a migração importam daqui sem
// carregar o servidor. Abrir NUNCA cria banco: criação é só por `inicializarTarefasDb` (fixture) ou pela migração explícita.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Erro do domínio de tarefas com status HTTP; o servidor converte em resposta, o CLI em stderr + exit≠0. */
export class TarefaErro extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const SCHEMA_TAREFAS = "irh-tarefas";
export const VERSAO_TAREFAS = "1";
/** Todas as colunas da tabela legada (db.ts migrações 13–15), na mesma ordem. */
export const COLUNAS_TAREFAS = ["id", "titulo", "frente", "status", "quem", "prazo", "urgente", "nota", "link", "origem", "passos",
  "criado_em", "atualizado_em", "feito_em", "hora", "entrega", "contexto", "trecho", "depende", "links", "historico", "desfecho"] as const;

const DDL = `
CREATE TABLE tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL, feito_em TEXT,
  hora TEXT,
  entrega TEXT NOT NULL DEFAULT '',
  contexto TEXT NOT NULL DEFAULT '',
  trecho TEXT NOT NULL DEFAULT '',
  depende TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  historico TEXT NOT NULL DEFAULT '[]',
  desfecho TEXT NOT NULL DEFAULT '');
CREATE INDEX tarefas_status ON tarefas(status, prazo);
CREATE TABLE tarefas_meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);`;

const expandir = (p: string, base: string) => {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(base, p);
};

export const vaultBrain = () => expandir(process.env.BRAIN_VAULT || process.env.IRH_VAULT || join(import.meta.dir, "../../.."), homedir());

export type FonteTarefas = { caminho: string; cli: string | null; legado: string | null; registro: string };

/** Lê o registro de fontes e devolve a entrada `tarefas` com caminhos absolutos. Registro ausente/inválido = erro. */
export function resolverFonteTarefas(vault = vaultBrain()): FonteTarefas {
  const registro = join(vault, "01_Memoria/Brain", "fontes.json");
  if (!existsSync(registro)) throw new TarefaErro(503, `Registro de fontes ausente: ${registro}`);
  let j: any;
  try { j = JSON.parse(readFileSync(registro, "utf8")); } catch (e: any) { throw new TarefaErro(503, `Registro de fontes ilegível: ${e?.message ?? e}`); }
  if (j?.schema !== 1 || !Array.isArray(j.fontes)) throw new TarefaErro(503, "Registro de fontes inválido (esperado schema 1 com fontes[])");
  const es = j.fontes.filter((f: any) => f?.id === "tarefas");
  if (es.length !== 1) throw new TarefaErro(503, `Registro de fontes deve ter exatamente uma entrada id=tarefas (tem ${es.length})`);
  const e = es[0];
  if (typeof e.caminho !== "string" || !e.caminho.trim()) throw new TarefaErro(503, "Entrada tarefas sem caminho");
  return {
    caminho: expandir(e.caminho, vault),
    cli: typeof e.cli === "string" ? expandir(e.cli, vault) : null,
    legado: typeof e.legado === "string" ? expandir(e.legado, vault) : null,
    registro,
  };
}

const pragmas = (db: Database) => db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

export function lerMeta(db: Database): Record<string, string> {
  try { return Object.fromEntries((db.query("SELECT chave, valor FROM tarefas_meta").all() as any[]).map((r) => [r.chave, r.valor])); }
  catch { return {}; }
}

/** Confere schema/metadado. Não altera nada. */
export function validarTarefasDb(db: Database, caminho: string) {
  const meta = lerMeta(db);
  if (meta.schema !== SCHEMA_TAREFAS || meta.versao !== VERSAO_TAREFAS) throw new TarefaErro(503, `Banco de tarefas sem metadado válido (não inicializado): ${caminho}`);
  if (meta.estado !== "ativo") throw new TarefaErro(503, `Banco de tarefas não está ativo (estado=${meta.estado ?? "?"}): ${caminho}`);
  const cols = (db.query("PRAGMA table_info(tarefas)").all() as any[]).map((c) => c.name);
  const faltam = COLUNAS_TAREFAS.filter((c) => !cols.includes(c));
  if (faltam.length) throw new TarefaErro(503, `Banco de tarefas sem colunas: ${faltam.join(", ")}`);
}

/** Abre banco JÁ inicializado. Ausente ou inválido = erro (nunca cria). */
export function abrirTarefasDb(caminho: string): Database {
  if (!existsSync(caminho)) throw new TarefaErro(503, `Banco de tarefas ausente: ${caminho} (não é criado automaticamente; rode a migração ou inicialize uma fixture)`);
  let db: Database;
  try { db = new Database(caminho, { readwrite: true, create: false, strict: false }); }
  catch (e: any) { throw new TarefaErro(503, `Banco de tarefas ilegível: ${e?.message ?? e}`); }
  try { pragmas(db); validarTarefasDb(db, caminho); }
  catch (e) { db.close(); throw e; }
  return db;
}

/** Cria o schema canônico num arquivo NOVO. Uso explícito (fixtures e migração). */
export function criarSchemaTarefas(caminho: string, meta: Record<string, string>): Database {
  if (existsSync(caminho)) throw new TarefaErro(409, `Já existe arquivo em ${caminho}; não sobrescrevo`);
  const db = new Database(caminho, { create: true, readwrite: true });
  db.exec("PRAGMA busy_timeout = 5000;");
  db.transaction(() => {
    db.exec(DDL);
    const ins = db.prepare("INSERT INTO tarefas_meta (chave, valor) VALUES (?, ?)");
    for (const [k, v] of Object.entries({ schema: SCHEMA_TAREFAS, versao: VERSAO_TAREFAS, estado: "ativo", criado_em: new Date().toISOString(), ...meta })) ins.run(k, v);
  }).immediate();
  return db;
}

/** Guardas de estado: com meta.estado ≠ 'ativo' (migrando/revertendo/revertido) o próprio SQLite nega INSERT/UPDATE/DELETE
 * em `tarefas`. Protege conexões antigas e a janela entre validar e escrever. Instalação é explícita (migração/upgrade/fixture). */
export const GUARDAS_ESTADO = ["insert", "update", "delete"].map((op) => ({ op, nome: `tarefas_estado_bloqueia_${op}` }));
export function instalarGuardasEstado(db: Database) {
  for (const g of GUARDAS_ESTADO) db.exec(`CREATE TRIGGER IF NOT EXISTS ${g.nome} BEFORE ${g.op.toUpperCase()} ON tarefas
    WHEN coalesce((SELECT valor FROM tarefas_meta WHERE chave = 'estado'), '') <> 'ativo'
    BEGIN SELECT RAISE(ABORT, 'banco de tarefas não está ativo: escrita bloqueada'); END;`);
}
export const guardasEstado = (db: Database) => (db.query(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tarefas' AND name LIKE 'tarefas_estado_bloqueia_%'`).all() as any[]).map((r) => r.name as string);

/** Inicialização explícita de fixture (testes/demonstração). Recusa o caminho canônico do registro. */
export function inicializarTarefasFixture(caminho: string, vault?: string): Database {
  const alvo = resolve(caminho);
  let canonico: string | null = null;
  try { canonico = resolve(resolverFonteTarefas(vault).caminho); } catch { /* sem registro: não há canônico a proteger */ }
  if (canonico && canonico === alvo) throw new TarefaErro(400, "Caminho canônico só é criado pela migração (scripts/migrar-tarefas.ts), não por inicialização de fixture");
  const db = criarSchemaTarefas(alvo, { origem: "fixture" });
  instalarGuardasEstado(db);
  pragmas(db);
  return db;
}
