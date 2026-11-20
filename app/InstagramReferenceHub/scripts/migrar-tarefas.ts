#!/usr/bin/env bun
// Migração explícita das tarefas: tabela legada `tarefas` do banco da biblioteca (irh.sqlite) → fonte canônica do registro.
//
//   bun scripts/migrar-tarefas.ts estado   [--origem ARQ] [--destino ARQ]
//   bun scripts/migrar-tarefas.ts migrar   [--origem ARQ] [--destino ARQ] [--backups DIR]
//   bun scripts/migrar-tarefas.ts reverter [--origem ARQ] [--destino ARQ] [--backups DIR]
//   bun scripts/migrar-tarefas.ts instalar-guardas [--origem ARQ] [--destino ARQ] [--backups DIR]  (upgrade: só DDL, backup antes)
//
// Sem --origem/--destino: resolve pelo registro (<BRAIN_VAULT>/_central/_brain/fontes.json, entrada tarefas: legado/caminho).
// Fixtures passam os dois caminhos explicitamente e não tocam o vault. Não para nem reinicia serviço algum.
//
// migrar: backup consistente (VACUUM INTO: lê pelo SQLite, inclui o que está no WAL) da origem e do destino existente →
//   trava a origem (BEGIN IMMEDIATE) → copia todas as colunas e IDs em transação para arquivo temporário → compara linha a
//   linha (quote() de cada coluna), contagem e max(id) → instala triggers que bloqueiam INSERT/UPDATE/DELETE na legada →
//   publica o destino em `migrando` → COMMIT da legada → só então `ativo`. Retomada: `migrando` + guardas = ativa;
//   `migrando` sem guardas = destino vai para backups e migra de novo. Recibo (contagem, max_id, sha256) sem conteúdo das tarefas.
//   Reexecução: se já migrado, só confere que a legada continua igual ao recibo (no-op). NUNCA compara o destino com o
//   snapshot para "corrigir" escritas novas do canônico. Destino existente sem recibo e diferente da origem = aborta.
// reverter: backup de ambos → COMMIT do canônico em `revertendo` (falha fechado; guardas de estado negam DML) → copia o
//   estado MAIS RECENTE para a legada removendo os triggers e gravando a marca no mesmo COMMIT → `revertido`. Falha antes do
//   COMMIT da legada volta o canônico a `ativo`; depois, fica `revertendo` e `reverter` de novo conclui sem recopiar.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { COLUNAS_TAREFAS, criarSchemaTarefas, GUARDAS_ESTADO, guardasEstado, instalarGuardasEstado, lerMeta, resolverFonteTarefas, SCHEMA_TAREFAS, TarefaErro } from "../server/tarefas-db";

const TRIGGERS = ["insert", "update", "delete"].map((op) => ({ op, nome: `tarefas_legado_bloqueia_${op}` }));
const COLS = COLUNAS_TAREFAS.join(", ");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

type Snap = { linhas: string[]; contagem: number; max_id: number; sha256: string };

/** Linhas completas, tipo preservado: quote() de cada coluna, ordenadas por id. */
function snapshot(db: Database, schema = "main"): Snap {
  const sel = COLUNAS_TAREFAS.map((c) => `quote(${c})`).join(" || char(31) || ");
  const linhas = (db.query(`SELECT ${sel} AS l FROM ${schema}.tarefas ORDER BY id`).all() as any[]).map((r) => r.l as string);
  const ids = db.query(`SELECT count(*) n, coalesce(max(id), 0) m FROM ${schema}.tarefas`).get() as any;
  return { linhas, contagem: ids.n, max_id: ids.m, sha256: createHash("sha256").update(linhas.join("\n")).digest("hex") };
}
const iguais = (a: Snap, b: Snap) => a.contagem === b.contagem && a.max_id === b.max_id && a.sha256 === b.sha256
  && a.linhas.every((l, i) => l === b.linhas[i]);
const resumo = (s: Snap) => ({ contagem: s.contagem, max_id: s.max_id, sha256: s.sha256 });
const temSequencia = (db: Database) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
const sequencia = (db: Database, maxId: number) => Math.max(maxId, temSequencia(db) ? Number((db.query("SELECT seq FROM sqlite_sequence WHERE name = 'tarefas'").get() as any)?.seq ?? 0) : 0);

function conferirColunas(db: Database, onde: string) {
  const cols = (db.query("PRAGMA table_info(tarefas)").all() as any[]).map((c) => c.name as string);
  if (!cols.length) throw new TarefaErro(1, `${onde}: tabela tarefas não existe`);
  const faltam = COLUNAS_TAREFAS.filter((c) => !cols.includes(c));
  const sobram = cols.filter((c) => !(COLUNAS_TAREFAS as readonly string[]).includes(c));
  if (faltam.length || sobram.length) throw new TarefaErro(1, `${onde}: colunas inesperadas (faltam: ${faltam.join(",") || "-"}; sobram: ${sobram.join(",") || "-"}). Atualize COLUNAS_TAREFAS antes.`);
}
const guardas = (db: Database) => (db.query(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='tarefas' AND name LIKE 'tarefas_legado_bloqueia_%'`).all() as any[]).map((r) => r.name as string);

function abrir(caminho: string, oque: string) {
  if (!existsSync(caminho)) throw new TarefaErro(1, `${oque} ausente: ${caminho}`);
  const db = new Database(caminho, { readwrite: true, create: false });
  db.exec("PRAGMA busy_timeout = 10000;");
  return db;
}

function backup(db: Database, dir: string, nome: string) {
  mkdirSync(dir, { recursive: true });
  const alvo = join(dir, nome);
  if (existsSync(alvo)) throw new TarefaErro(1, `Backup já existe: ${alvo}`);
  db.exec(`VACUUM INTO '${alvo.replace(/'/g, "''")}'`);
  const chk = new Database(alvo, { readonly: true });
  try { if ((chk.query("PRAGMA integrity_check").get() as any)?.integrity_check !== "ok") throw new TarefaErro(1, `Backup corrompido: ${alvo}`); }
  finally { chk.close(); }
  return alvo;
}

type Caminhos = { origem: string; destino: string; backups: string };
function caminhos(o: Record<string, string>): Caminhos {
  let origem: string | null = o["--origem"] ?? null, destino: string | null = o["--destino"] ?? null;
  if (!origem || !destino) {
    const f = resolverFonteTarefas();
    origem ??= f.legado;
    destino ??= f.caminho;
  }
  if (!origem) throw new TarefaErro(1, "Registro sem `legado` para tarefas; passe --origem");
  origem = resolve(origem); destino = resolve(destino!);
  if (origem === destino) throw new TarefaErro(1, "Origem e destino iguais");
  return { origem, destino, backups: resolve(o["--backups"] ?? join(dirname(destino), "backups")) };
}

export function estado(c: Caminhos) {
  const out: Record<string, unknown> = { origem: c.origem, destino: c.destino };
  if (existsSync(c.origem)) {
    const db = new Database(c.origem, { readwrite: true, create: false }); // WAL: readonly puro falha sem -shm; nada é escrito
    try { out.origem_guardas = guardas(db); out.origem_resumo = resumo(snapshot(db)); } finally { db.close(); }
  } else out.origem_resumo = null;
  if (existsSync(c.destino)) {
    const db = new Database(c.destino, { readwrite: true, create: false });
    try { const m = lerMeta(db); out.destino_meta = { schema: m.schema, versao: m.versao, estado: m.estado, origem: m.origem, recibo: m.recibo ? JSON.parse(m.recibo) : null }; out.destino_resumo = resumo(snapshot(db)); }
    finally { db.close(); }
  } else out.destino_meta = null;
  return out;
}

/** Pontos de etapa para testes de falha/crash (fixtures). Produção não passa nada. */
export type Opcoes = { etapa?: (nome: string) => void };
const MARCA = "tarefas_legado_reversao"; // marca na legada, gravada no MESMO commit que a devolve como fonte
const temMarca = (db: Database) => !!db.query(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${MARCA}'`).get();
const lerMarca = (db: Database) => temMarca(db) ? db.query(`SELECT sha256, contagem, revertido_em FROM ${MARCA} WHERE id = 1`).get() as any : null;
const setEstado = (db: Database, estado: string) => db.run("UPDATE tarefas_meta SET valor = ? WHERE chave = 'estado'", [estado]);
const aoLado = (c: Caminhos, rotulo: string) => {
  const aside = join(c.backups, `destino-${rotulo}-${stamp()}.sqlite`);
  mkdirSync(c.backups, { recursive: true });
  renameSync(c.destino, aside);
  for (const s of ["-wal", "-shm"]) if (existsSync(c.destino + s)) renameSync(c.destino + s, aside + s);
  return aside;
};

/** Destino publicado em `migrando` com a legada já congelada: confere e ativa. */
function ativarMigrado(c: Caminhos, origem: Database) {
  const d = abrir(c.destino, "Destino");
  try {
    d.exec("BEGIN IMMEDIATE");
    try {
      const meta = lerMeta(d);
      if (meta.estado !== "migrando" || !meta.recibo) throw new TarefaErro(1, `Destino em estado inesperado (${meta.estado}) ao ativar`);
      const recibo = JSON.parse(meta.recibo);
      const sO = snapshot(origem), sD = snapshot(d);
      if (sO.sha256 !== recibo.sha256 || sD.sha256 !== recibo.sha256) throw new TarefaErro(1, "Legada ou destino divergem do recibo: não ativo, verifique manualmente");
      instalarGuardasEstado(d);
      setEstado(d, "ativo");
      d.exec("COMMIT");
      d.exec("PRAGMA journal_mode = WAL;");
      return recibo;
    } catch (e) { try { d.exec("ROLLBACK"); } catch {} throw e; }
  } finally { d.close(); }
}

export function migrar(c: Caminhos, op: Opcoes = {}) {
  const origem = abrir(c.origem, "Origem");
  try {
    conferirColunas(origem, "Origem");
    const instaladas = guardas(origem);
    const st = stamp();

    if (existsSync(c.destino)) {
      const d = abrir(c.destino, "Destino");
      let meta: Record<string, string>, snapD: Snap | null = null, gEstado: string[] = [];
      try { meta = lerMeta(d); if (meta.schema === SCHEMA_TAREFAS) { snapD = snapshot(d); gEstado = guardasEstado(d); } } finally { d.close(); }
      if (meta.schema === SCHEMA_TAREFAS && meta.recibo && meta.estado === "ativo") {
        // Já migrado: a legada está congelada e deve continuar idêntica ao que foi copiado. Destino NÃO é comparado
        // com o snapshot (ele tem escritas novas legítimas) e nunca é sobrescrito.
        const recibo = JSON.parse(meta.recibo);
        const snapO = snapshot(origem);
        if (instaladas.length !== TRIGGERS.length) throw new TarefaErro(1, "Destino diz migrado mas a legada está sem guardas: estado inconsistente, verifique manualmente");
        if (snapO.sha256 !== recibo.sha256 || snapO.contagem !== recibo.contagem) throw new TarefaErro(1, "Legada divergiu do recibo da migração: abortado sem alterar nada");
        return { resultado: "ja_migrado", recibo, destino_atual: { contagem: snapD!.contagem, max_id: snapD!.max_id }, guardas_estado: gEstado.length === GUARDAS_ESTADO.length };
      }
      if (meta.schema === SCHEMA_TAREFAS && meta.estado === "migrando" && meta.recibo) {
        // Retomada: o destino publicado em `migrando` nunca aceitou escrita (validação + guardas de estado).
        if (instaladas.length === TRIGGERS.length) return { resultado: "migrado", retomado: true, recibo: ativarMigrado(c, origem) };
        if (instaladas.length === 0) aoLado(c, "migrando-abortado"); // COMMIT da legada não aconteceu: legada segue fonte; refaz
        else throw new TarefaErro(1, "Destino em migrando e legada com guardas parciais: verifique manualmente");
      } else if (meta.schema === SCHEMA_TAREFAS && meta.estado === "revertido") {
        aoLado(c, "revertido"); // Rollback anterior: a legada voltou a ser a fonte. Guarda o canônico antigo e migra de novo.
      } else if (meta.schema === SCHEMA_TAREFAS && meta.estado === "revertendo") {
        throw new TarefaErro(1, "Destino em revertendo: rode `reverter` para concluir antes de migrar");
      } else {
        throw new TarefaErro(1, `Destino já existe e não é uma migração concluída (${meta.schema ?? "sem schema"}/${meta.estado ?? "-"}): não sobrescrevo`);
      }
    }
    if (instaladas.length) throw new TarefaErro(1, "Legada já tem guardas mas não há destino migrado: rode `reverter` ou verifique manualmente");

    const bkOrigem = backup(origem, c.backups, `origem-${basename(c.origem)}-${st}.sqlite`);
    mkdirSync(dirname(c.destino), { recursive: true });
    const tmp = `${c.destino}.migrando-${process.pid}`;
    rmSync(tmp, { force: true });

    origem.exec("BEGIN IMMEDIATE"); // ninguém escreve na legada entre a cópia e as guardas
    let publicado = false;
    let commitado = false;
    try {
      const snapO = snapshot(origem);
      const seqO = sequencia(origem, snapO.max_id);
      const linhas = origem.query(`SELECT ${COLS} FROM tarefas ORDER BY id`).values();
      const dest = criarSchemaTarefas(tmp, { origem: c.origem, estado: "migrando" });
      let recibo: any;
      try {
        dest.transaction(() => {
          const ins = dest.prepare(`INSERT INTO tarefas (${COLS}) VALUES (${COLUNAS_TAREFAS.map(() => "?").join(",")})`);
          for (const l of linhas) ins.run(...(l as any[]));
          dest.run("DELETE FROM sqlite_sequence WHERE name = 'tarefas'");
          dest.run("INSERT INTO sqlite_sequence (name, seq) VALUES ('tarefas', ?)", [seqO]);
        }).immediate();
        const snapD = snapshot(dest);
        if (!iguais(snapO, snapD)) throw new TarefaErro(1, "Comparação linha a linha falhou: destino diferente da origem; nada publicado");
        recibo = { ...resumo(snapO), migrado_em: new Date().toISOString(), origem: c.origem, backup_origem: bkOrigem, colunas: COLUNAS_TAREFAS.length };
        dest.transaction(() => {
          // Continua `migrando`: publicado, mas fechado para leitura/escrita até a legada estar confirmada como congelada.
          dest.run("INSERT INTO tarefas_meta (chave, valor) VALUES ('recibo', ?)", [JSON.stringify(recibo)]);
          instalarGuardasEstado(dest);
        }).immediate();
      } finally { dest.close(); }
      if (temMarca(origem)) origem.exec(`DROP TABLE ${MARCA}`);
      for (const t of TRIGGERS) origem.exec(`CREATE TRIGGER ${t.nome} BEFORE ${t.op.toUpperCase()} ON tarefas BEGIN SELECT RAISE(ABORT, 'tarefas migradas para a fonte canônica: tabela legada somente leitura'); END;`);
      renameSync(tmp, c.destino);
      publicado = true;
      op.etapa?.("publicado");
      origem.exec("COMMIT");
      commitado = true; // legada congelada; daqui em diante nada é apagado: retomada ativa o destino
      op.etapa?.("origem-commitada");
      ativarMigrado(c, origem);
      writeFileSync(join(c.backups, `recibo-migracao-${st}.json`), JSON.stringify({ ...recibo, destino: c.destino }, null, 2));
      return { resultado: "migrado", recibo };
    } catch (e) {
      if (!commitado) {
        try { origem.exec("ROLLBACK"); } catch {}
        rmSync(tmp, { force: true });
        // Destino publicado em `migrando` nunca foi fonte (escrita bloqueada); a legada continua a fonte.
        if (publicado) rmSync(c.destino, { force: true });
      }
      throw e;
    }
  } finally { origem.close(); }
}

/** Upgrade explícito: instala as guardas de estado num canônico ativo já migrado. Só DDL; nenhuma tarefa muda. */
export function instalarGuardas(c: Caminhos) {
  const d = abrir(c.destino, "Destino");
  try {
    const meta = lerMeta(d);
    if (meta.schema !== SCHEMA_TAREFAS || meta.estado !== "ativo") throw new TarefaErro(1, `Destino não é canônico ativo (${meta.estado ?? "?"})`);
    conferirColunas(d, "Destino");
    if (guardasEstado(d).length === GUARDAS_ESTADO.length) return { resultado: "ja_instaladas", guardas: guardasEstado(d) };
    const bk = backup(d, c.backups, `guardas-destino-${stamp()}.sqlite`);
    d.exec("BEGIN IMMEDIATE");
    try {
      const antes = snapshot(d);
      instalarGuardasEstado(d);
      if (!iguais(antes, snapshot(d))) throw new TarefaErro(1, "Tarefas mudaram durante o upgrade; desfeito");
      d.exec("COMMIT");
      return { resultado: "guardas_instaladas", guardas: guardasEstado(d), backup: bk, resumo: resumo(antes) };
    } catch (e) { try { d.exec("ROLLBACK"); } catch {} throw e; }
  } finally { d.close(); }
}

export function reverter(c: Caminhos, op: Opcoes = {}) {
  const dest = abrir(c.destino, "Destino");
  const origem = abrir(c.origem, "Origem");
  try {
    const meta = lerMeta(dest);
    if (meta.schema !== SCHEMA_TAREFAS || !meta.recibo || !["ativo", "revertendo"].includes(meta.estado)) throw new TarefaErro(1, `Destino não é uma migração ativa (${meta.estado ?? "?"}): nada a reverter`);
    conferirColunas(origem, "Origem");
    const st = stamp();
    const g = guardas(origem).length;
    const concluir = () => {
      dest.exec("BEGIN IMMEDIATE");
      setEstado(dest, "revertido");
      dest.run("INSERT OR REPLACE INTO tarefas_meta (chave, valor) VALUES ('revertido_em', ?)", [new Date().toISOString()]);
      dest.exec("COMMIT");
    };

    if (meta.estado === "revertendo") {
      // Retomada. O canônico está congelado desde o commit de `revertendo`.
      const snapD = snapshot(dest);
      const marca = lerMarca(origem);
      if (g === 0 && marca) {
        // A legada já voltou a ser fonte (pode ter escritas novas): NÃO recopia; só fecha o canônico.
        if (marca.sha256 !== snapD.sha256) throw new TarefaErro(1, "Marca da legada não corresponde ao canônico congelado: verifique manualmente");
        concluir();
        return { resultado: "revertido", retomado: true, recibo: { ...resumo(snapD), legada_ja_ativa: true } };
      }
      if (g !== TRIGGERS.length || marca) throw new TarefaErro(1, "Canônico em revertendo e legada em estado incoerente: verifique manualmente (canônico segue bloqueado)");
      // Legada ainda congelada: o commit da origem não aconteceu; segue a cópia com o canônico congelado.
    } else if (g !== TRIGGERS.length) {
      throw new TarefaErro(1, "Legada sem as guardas da migração: não reverto por cima de uma fonte que pode estar ativa");
    }
    const bks = { origem: backup(origem, c.backups, `rollback-origem-${st}.sqlite`), destino: backup(dest, c.backups, `rollback-destino-${st}.sqlite`) };

    let congelado = meta.estado === "revertendo";
    if (!congelado) {
      // 1) Congela o canônico em `revertendo` confirmado ANTES de a legada aceitar escrita.
      dest.exec("BEGIN IMMEDIATE");
      try {
        instalarGuardasEstado(dest);
        setEstado(dest, "revertendo");
        dest.run("INSERT OR REPLACE INTO tarefas_meta (chave, valor) VALUES ('revertendo_em', ?)", [new Date().toISOString()]);
        dest.exec("COMMIT");
      } catch (e) { try { dest.exec("ROLLBACK"); } catch {} throw e; }
      congelado = true;
    }
    let origemCommitada = false;
    try {
      op.etapa?.("congelado");
      const snapD = snapshot(dest);
      const seqD = sequencia(dest, snapD.max_id);
      const linhas = dest.query(`SELECT ${COLS} FROM tarefas ORDER BY id`).values();
      // 2) Devolve a escrita à legada com a marca no mesmo commit.
      origem.exec("BEGIN IMMEDIATE");
      try {
        for (const t of TRIGGERS) origem.exec(`DROP TRIGGER ${t.nome}`);
        origem.run("DELETE FROM tarefas");
        const ins = origem.prepare(`INSERT INTO tarefas (${COLS}) VALUES (${COLUNAS_TAREFAS.map(() => "?").join(",")})`);
        for (const l of linhas) ins.run(...(l as any[]));
        // Preserva o contador quando a legada usa AUTOINCREMENT; INTEGER PRIMARY KEY puro não tem sqlite_sequence.
        if (temSequencia(origem)) {
          origem.run("DELETE FROM sqlite_sequence WHERE name = 'tarefas'");
          origem.run("INSERT INTO sqlite_sequence (name, seq) VALUES ('tarefas', ?)", [seqD]);
        }
        if (!iguais(snapD, snapshot(origem))) throw new TarefaErro(1, "Comparação do rollback falhou; nada alterado");
        origem.exec(`CREATE TABLE IF NOT EXISTS ${MARCA} (id INTEGER PRIMARY KEY CHECK (id = 1), sha256 TEXT NOT NULL, contagem INTEGER NOT NULL, revertido_em TEXT NOT NULL)`);
        origem.run(`INSERT OR REPLACE INTO ${MARCA} (id, sha256, contagem, revertido_em) VALUES (1, ?, ?, ?)`, [snapD.sha256, snapD.contagem, new Date().toISOString()]);
        op.etapa?.("origem-copiada");
        origem.exec("COMMIT");
      } catch (e) { try { origem.exec("ROLLBACK"); } catch {} throw e; }
      origemCommitada = true;
      op.etapa?.("origem-commitada");
      // 3) Fecha o canônico de vez.
      concluir();
      const recibo = { ...resumo(snapD), revertido_em: new Date().toISOString(), backups: bks };
      writeFileSync(join(c.backups, `recibo-rollback-${st}.json`), JSON.stringify(recibo, null, 2));
      return { resultado: "revertido", recibo };
    } catch (e) {
      try { dest.exec("ROLLBACK"); } catch {}
      if (!origemCommitada && meta.estado === "ativo") {
        // Legada não recebeu a escrita: o canônico volta a ser a fonte ativa.
        try { dest.exec("BEGIN IMMEDIATE"); setEstado(dest, "ativo"); dest.exec("COMMIT"); } catch { try { dest.exec("ROLLBACK"); } catch {} }
      }
      // Depois do commit da legada o canônico fica em `revertendo` (bloqueado); `reverter` de novo conclui.
      throw e;
    }
  } finally { origem.close(); dest.close(); }
}

if (import.meta.main) {
  try {
    const [cmd, ...r] = process.argv.slice(2);
    const o: Record<string, string> = {};
    for (let i = 0; i < r.length; i += 2) {
      if (!["--origem", "--destino", "--backups"].includes(r[i]) || r[i + 1] === undefined) throw new TarefaErro(2, `Argumento inválido: ${r[i]}`);
      o[r[i]] = r[i + 1];
    }
    const c = caminhos(o);
    const fn = ({ estado, migrar, reverter, "instalar-guardas": instalarGuardas } as Record<string, (c: Caminhos) => unknown>)[cmd];
    if (!fn) throw new TarefaErro(2, "Uso: migrar-tarefas.ts estado|migrar|reverter|instalar-guardas [--origem ARQ] [--destino ARQ] [--backups DIR]");
    process.stdout.write(JSON.stringify(fn(c), null, 2) + "\n");
  } catch (e: any) {
    process.stderr.write(`erro: ${e?.message ?? e}\n`);
    process.exitCode = e instanceof TarefaErro && e.status === 2 ? 2 : 1;
  }
}
