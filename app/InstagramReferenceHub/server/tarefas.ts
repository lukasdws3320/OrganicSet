// Tarefas da operação inteira (todas as frentes: experts, perfis de IA, Hub, infra…). Domínio ÚNICO: a API do Hub
// (/api/tarefas) e o CLI sem UI (scripts/tarefas.ts) gravam só por estas funções. Fonte canônica: SQLite próprio
// resolvido pelo registro de fontes do vault (server/tarefas-db.ts) — não é mais a tabela do banco da biblioteca.
// Sem imports do servidor: o CLI carrega este arquivo sem ligar filas nem runtime do Hub.
import type { Database } from "bun:sqlite";
import { TarefaErro as HttpError } from "./tarefas-db";

const now = () => new Date().toISOString();

export const STATUS_TAREFA = ["a_fazer", "fazendo", "esperando", "feito"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];
export type Passo = { t: string; feito: boolean };
/** `trava: true` = impede começar; `false` = só precisa depois (revisão, aprovação). */
export type Dependencia = { quem: string; oque: string; trava: boolean };
export type LinkTarefa = { label: string; url: string };
export type Evento = { d: string; quem: string; oque: string };
export type Tarefa = {
  id: number; codigo: string; titulo: string; frente: string; status: StatusTarefa; quem: string;
  prazo: string | null; hora: string | null; urgente: boolean; nota: string; link: string; origem: string; passos: Passo[];
  entrega: string; contexto: string; trecho: string; depende: Dependencia[]; links: LinkTarefa[]; historico: Evento[]; desfecho: string;
  criado_em: string; atualizado_em: string; feito_em: string | null;
};

const NOME_STATUS: Record<StatusTarefa, string> = { a_fazer: "A fazer", fazendo: "Fazendo", esperando: "Esperando", feito: "Feito" };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const lista = <T>(v: string): T[] => { try { return JSON.parse(v) as T[]; } catch { return []; } };
const linha = (r: any): Tarefa => ({
  id: r.id, codigo: `T-${r.id}`, titulo: r.titulo, frente: r.frente, status: r.status, quem: r.quem,
  prazo: r.prazo, hora: r.hora ?? null, urgente: !!r.urgente, nota: r.nota, link: r.link, origem: r.origem,
  passos: lista<Passo>(r.passos), entrega: r.entrega, contexto: r.contexto, trecho: r.trecho, depende: lista<Dependencia>(r.depende),
  links: lista<LinkTarefa>(r.links), historico: lista<Evento>(r.historico), desfecho: r.desfecho,
  criado_em: r.criado_em, atualizado_em: r.atualizado_em, feito_em: r.feito_em,
});
/** Aceita 12, "12" ou "T-12". */
export const idTarefa = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/^T-?/i, ""));
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Tarefa inválida (use T-12 ou 12)");
  return n;
};

const texto = (v: unknown, max: number) => String(v ?? "").replace(/\s+$/, "").slice(0, max);
function campos(b: any, parcial: boolean) {
  const c: Record<string, unknown> = {};
  if (!parcial || b.titulo !== undefined) {
    const t = texto(b.titulo, 300).trim();
    if (!t) throw new HttpError(400, "Escreva o que precisa ser feito");
    c.titulo = t;
  }
  if (b.frente !== undefined) c.frente = texto(b.frente, 60).trim() || "Geral";
  if (b.quem !== undefined) c.quem = texto(b.quem, 40).trim() || "Matheus";
  if (b.status !== undefined) {
    if (!STATUS_TAREFA.includes(b.status)) throw new HttpError(400, `Status inválido (use ${STATUS_TAREFA.join(", ")})`);
    c.status = b.status;
  }
  if (b.prazo !== undefined) {
    const p = b.prazo ? String(b.prazo) : null;
    if (p && !DATA.test(p)) throw new HttpError(400, "Prazo deve ser AAAA-MM-DD");
    c.prazo = p;
  }
  if (b.hora !== undefined) {
    const h = b.hora ? String(b.hora) : null;
    if (h && !/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) throw new HttpError(400, "Hora deve ser HH:MM");
    c.hora = h;
  }
  if (b.urgente !== undefined) c.urgente = b.urgente ? 1 : 0;
  for (const k of ["nota", "link", "origem", "entrega", "contexto", "trecho", "desfecho"] as const) if (b[k] !== undefined) c[k] = texto(b[k], k === "link" || k === "origem" ? 500 : 4000).trim();
  if (b.passos !== undefined) {
    if (!Array.isArray(b.passos)) throw new HttpError(400, "passos deve ser uma lista");
    c.passos = JSON.stringify(b.passos.map((p: any) => (typeof p === "string" ? { t: p, feito: false } : { t: texto(p?.t, 300).trim(), feito: !!p?.feito }))
      .filter((p: Passo) => p.t).slice(0, 50));
  }
  const listaDe = (k: string) => { if (!Array.isArray(b[k])) throw new HttpError(400, `${k} deve ser uma lista`); return b[k] as any[]; };
  if (b.depende !== undefined) c.depende = JSON.stringify(listaDe("depende").map((d) => ({ quem: texto(d?.quem, 60).trim(), oque: texto(d?.oque, 300).trim(), trava: d?.trava !== false })).filter((d) => d.oque).slice(0, 20));
  if (b.links !== undefined) c.links = JSON.stringify(listaDe("links").map((l) => ({ label: texto(l?.label, 80).trim(), url: texto(l?.url, 500).trim() })).filter((l) => l.url).slice(0, 20));
  if (b.historico !== undefined) c.historico = JSON.stringify(listaDe("historico").map((e) => ({ d: texto(e?.d, 16).trim(), quem: texto(e?.quem, 60).trim(), oque: texto(e?.oque, 600).trim() })).filter((e) => e.oque).slice(0, 100));
  return c;
}

/** Abertas + feitas nos últimos `diasFeitas` dias (todas com `todas`). Ordem: urgente, prazo, mais antiga. */
export function listarTarefas(db: Database, o: { frente?: string | null; quem?: string | null; todas?: boolean; diasFeitas?: number } = {}): Tarefa[] {
  const corte = new Date(Date.now() - (o.diasFeitas ?? 14) * 864e5).toISOString();
  const rows = db.query(`SELECT * FROM tarefas WHERE (status <> 'feito' OR ?1 OR feito_em >= ?2)
    AND (?3 IS NULL OR frente = ?3 COLLATE NOCASE) AND (?4 IS NULL OR quem = ?4 COLLATE NOCASE)
    ORDER BY status = 'feito', prazo IS NULL, prazo, hora IS NULL, hora, urgente DESC, id`).all(o.todas ? 1 : 0, corte, o.frente ?? null, o.quem ?? null);
  return rows.map(linha);
}

export function obterTarefa(db: Database, id: number): Tarefa {
  const r = db.query("SELECT * FROM tarefas WHERE id = ?").get(id);
  if (!r) throw new HttpError(404, `T-${id} não existe`);
  return linha(r);
}

export function criarTarefa(db: Database, b: any): Tarefa {
  return db.transaction(() => criarTarefaTx(db, b)).immediate();
}
function criarTarefaTx(db: Database, b: any): Tarefa {
  const c: Record<string, any> = { frente: "Geral", quem: "Matheus", status: "a_fazer", prazo: null, hora: null, urgente: 0, nota: "", link: "", origem: "", passos: "[]", entrega: "", contexto: "", trecho: "", depende: "[]", links: "[]", historico: "[]", desfecho: "", ...campos(b ?? {}, false) };
  const t = now();
  const r = db.query(`INSERT INTO tarefas (titulo, frente, status, quem, prazo, hora, urgente, nota, link, origem, passos, entrega, contexto, trecho, depende, links, historico, desfecho, criado_em, atualizado_em, feito_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`).get(c.titulo, c.frente, c.status, c.quem, c.prazo, c.hora, c.urgente, c.nota, c.link, c.origem, c.passos, c.entrega, c.contexto, c.trecho, c.depende, c.links, c.historico, c.desfecho, t, t, c.status === "feito" ? t : null) as any;
  return obterTarefa(db, r.id);
}

/** Transação imediata: ler o histórico e gravar acontecem sob o mesmo lock (edições concorrentes não perdem eventos). */
export function editarTarefa(db: Database, id: number, b: any): Tarefa {
  const { t, mudou } = db.transaction(() => editarTarefaTx(db, id, b)).immediate();
  if (mudou) sincronizarAgenda();
  return t;
}
function editarTarefaTx(db: Database, id: number, b: any): { t: Tarefa; mudou: boolean } {
  const antes = obterTarefa(db, id);
  const c = campos(b ?? {}, true);
  if (!Object.keys(c).length) return { t: antes, mudou: false };
  if (c.status !== undefined && c.status !== antes.status) {
    c.feito_em = c.status === "feito" ? now() : null;
    // A mudança de situação fica registrada sozinha, em cima do histórico enviado (se veio algum).
    const base = c.historico !== undefined ? JSON.parse(c.historico as string) as Evento[] : antes.historico;
    c.historico = JSON.stringify([...base, { d: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }), quem: "", oque: `${NOME_STATUS[antes.status]} → ${NOME_STATUS[c.status as StatusTarefa]}` }]);
    if (c.status !== "feito" && b.desfecho === undefined) c.desfecho = "";
  }
  c.atualizado_em = now();
  const ks = Object.keys(c);
  db.run(`UPDATE tarefas SET ${ks.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...ks.map((k) => c[k] as any), id]);
  return { t: obterTarefa(db, id), mudou: c.status !== undefined && c.status !== antes.status };
}

/** Demanda mudou de situação = a agenda acompanha (bloco de T-n feita sai; reaberta volta). Em segundo plano. */
let agendaTimer: ReturnType<typeof setTimeout> | null = null;
let agendaAtrasoMs = 3000;
/** CLI usa 0 (dispara já, desacoplado, e o processo pode sair). */
export function configurarAgenda(o: { atrasoMs?: number }) { if (o.atrasoMs !== undefined) agendaAtrasoMs = o.atrasoMs; }
export const agendaDesligada = () => !!process.env.HUB_SEM_AGENDA || process.env.NODE_ENV === "test";
export function sincronizarAgenda() {
  if (agendaDesligada()) return; // testes e --sem-agenda nunca mexem na agenda real
  if (agendaTimer) clearTimeout(agendaTimer);
  agendaTimer = setTimeout(() => {
    agendaTimer = null;
    try {
      const log = Bun.file(`${process.env.HOME}/Library/Application Support/AgendaDemandas/ultima.log`);
      Bun.spawn(["python3", new URL("../scripts/agenda-demandas.py", import.meta.url).pathname], { stdout: log, stderr: log }).unref();
    } catch {}
  }, agendaAtrasoMs);
}

export function apagarTarefa(db: Database, id: number): Tarefa {
  return db.transaction(() => {
    const t = obterTarefa(db, id);
    db.run("DELETE FROM tarefas WHERE id = ?", [id]);
    return t;
  }).immediate();
}

/** Valores já usados (para sugerir no formulário e no CLI). */
export function opcoesTarefas(db: Database) {
  const col = (k: "frente" | "quem") => (db.query(`SELECT ${k} v, count(*) n FROM tarefas GROUP BY ${k} COLLATE NOCASE ORDER BY n DESC`).all() as any[]).map((r) => r.v as string);
  return { frentes: col("frente"), quem: col("quem"), status: STATUS_TAREFA };
}
