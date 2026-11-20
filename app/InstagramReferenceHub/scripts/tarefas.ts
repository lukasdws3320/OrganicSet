#!/usr/bin/env bun
// CLI das tarefas (T-n) sem UI e sem HTTP do Hub. Usa o MESMO domínio da API (server/tarefas.ts) sobre a fonte canônica
// resolvida pelo registro <BRAIN_VAULT>/_central/_brain/fontes.json (id "tarefas"). Não importa o servidor nem liga filas.
//
//   bun scripts/tarefas.ts listar [--todas] [--frente F] [--quem Q]   → {"tarefas":[...],"opcoes":{...}}
//   bun scripts/tarefas.ts obter --id T-N                              → tarefa
//   bun scripts/tarefas.ts criar --json '{"titulo":"..."}'             → tarefa
//   bun scripts/tarefas.ts editar --id T-N --json '{"status":"feito"}' → tarefa
//   bun scripts/tarefas.ts apagar --id T-N                             → tarefa apagada
//   bun scripts/tarefas.ts fonte                                       → {"caminho","registro"} (sem conteúdo)
//   bun scripts/tarefas.ts inicializar-fixture --db CAMINHO            → cria banco vazio (nunca o canônico)
// Opções: --db CAMINHO (só banco já inicializado) · --sem-agenda (não aciona agenda-demandas.py).
// NODE_ENV=test e HUB_SEM_AGENDA=1 também desligam a agenda. Sucesso: JSON no stdout, exit 0. Erro: stderr, exit ≠ 0.
import { abrirTarefasDb, inicializarTarefasFixture, resolverFonteTarefas, TarefaErro } from "../server/tarefas-db";
import { apagarTarefa, configurarAgenda, criarTarefa, editarTarefa, idTarefa, listarTarefas, obterTarefa, opcoesTarefas } from "../server/tarefas";

const BOOL = new Set(["--todas", "--sem-agenda"]);
const VALOR = new Set(["--id", "--json", "--db", "--frente", "--quem"]);

function args(argv: string[]) {
  const [cmd, ...resto] = argv;
  const o: Record<string, string | true> = {};
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (BOOL.has(a)) o[a] = true;
    else if (VALOR.has(a)) {
      const v = resto[++i];
      if (v === undefined) throw new TarefaErro(2, `${a} precisa de valor`);
      o[a] = v;
    } else throw new TarefaErro(2, `Argumento desconhecido: ${a}`);
  }
  return { cmd, o };
}

function corpo(o: Record<string, string | true>) {
  if (typeof o["--json"] !== "string") throw new TarefaErro(2, "--json é obrigatório");
  try {
    const j = JSON.parse(o["--json"]);
    if (!j || typeof j !== "object" || Array.isArray(j)) throw new Error("esperado objeto");
    return j;
  } catch (e: any) { throw new TarefaErro(2, `--json inválido: ${e?.message ?? e}`); }
}

function main(argv: string[]): unknown {
  const { cmd, o } = args(argv);
  if (!cmd) throw new TarefaErro(2, "Uso: tarefas.ts listar|obter|criar|editar|apagar|fonte|inicializar-fixture [opções]");
  if (o["--sem-agenda"]) process.env.HUB_SEM_AGENDA = "1";
  configurarAgenda({ atrasoMs: 0 });
  const dbArg = typeof o["--db"] === "string" ? o["--db"] : null;

  if (cmd === "inicializar-fixture") {
    if (!dbArg) throw new TarefaErro(2, "inicializar-fixture exige --db CAMINHO explícito");
    inicializarTarefasFixture(dbArg).close();
    return { ok: true, caminho: dbArg };
  }
  if (cmd === "fonte") { const f = resolverFonteTarefas(); return { caminho: f.caminho, registro: f.registro, cli: f.cli }; }

  const db = abrirTarefasDb(dbArg ?? resolverFonteTarefas().caminho);
  try {
    switch (cmd) {
      case "listar": return {
        tarefas: listarTarefas(db, { todas: !!o["--todas"], frente: (o["--frente"] as string) ?? null, quem: (o["--quem"] as string) ?? null }),
        opcoes: opcoesTarefas(db),
      };
      case "obter": return obterTarefa(db, idTarefa(o["--id"]));
      case "criar": return criarTarefa(db, corpo(o));
      case "editar": return editarTarefa(db, idTarefa(o["--id"]), corpo(o));
      case "apagar": return apagarTarefa(db, idTarefa(o["--id"]));
      default: throw new TarefaErro(2, `Comando desconhecido: ${cmd}`);
    }
  } finally { db.close(); }
}

try {
  process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + "\n");
} catch (e: any) {
  process.stderr.write(`erro: ${e?.message ?? e}\n`);
  process.exitCode = e instanceof TarefaErro ? (e.status === 2 ? 2 : 1) : 1;
}
