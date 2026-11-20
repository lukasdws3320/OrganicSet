import { CalendarDays, Check, Columns3, ExternalLink, Flag, ListTodo, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { act, api, invalidate, isTyping, navigate, useApi, useLocation, usePref } from "../lib";
import { producaoHref } from "../replication-experts";
import { Button, cx, Empty, ErrorState, Field, Modal, MoreMenu, PageHeader, Segmented, Skeleton } from "../ui";
import type { PipelineResponse } from "../../../server/types";
import type { CarrosselApi } from "./Carrossel";
import "../tarefas.css";

export type StatusTarefa = "a_fazer" | "fazendo" | "esperando" | "feito";
export type Tarefa = {
  id: number; codigo: string; titulo: string; frente: string; status: StatusTarefa; quem: string; prazo: string | null; hora: string | null; urgente: boolean;
  nota: string; link: string; origem: string; passos: { t: string; feito: boolean }[];
  entrega: string; contexto: string; trecho: string; depende: Dependencia[]; links: { label: string; url: string }[]; historico: { d: string; quem: string; oque: string }[]; desfecho: string;
  criado_em: string; atualizado_em: string; feito_em: string | null;
};
type Dependencia = { quem: string; oque: string; trava: boolean };
type Resp = { tarefas: Tarefa[]; opcoes: { frentes: string[]; quem: string[] } };
type Visao = "hoje" | "quadro" | "frentes";

const COLUNAS: { s: StatusTarefa; label: string }[] = [
  { s: "a_fazer", label: "A fazer" }, { s: "fazendo", label: "Fazendo" }, { s: "esperando", label: "Esperando alguém" }, { s: "feito", label: "Feito" },
];
const LABEL = Object.fromEntries(COLUNAS.map((c) => [c.s, c.label])) as Record<StatusTarefa, string>;
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const maisDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dataCurta = (iso: string, hoje: string) => {
  if (iso === hoje) return "hoje";
  if (iso === maisDias(hoje, 1)) return "amanhã";
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};
/** O que aparece na lista debaixo do título: o que trava, senão o próximo passo, senão a situação. */
const proximaAcao = (t: Tarefa): { tipo: "trava" | "passo" | "nota"; texto: string } | null => {
  if (t.status === "feito") return t.desfecho ? { tipo: "nota", texto: t.desfecho } : null;
  const trava = t.depende.find((d) => d.trava);
  if (trava) return { tipo: "trava", texto: `${trava.quem ? `${trava.quem}: ` : ""}${trava.oque}` };
  const passo = t.passos.find((p) => !p.feito);
  if (passo) return { tipo: "passo", texto: passo.t };
  return t.nota ? { tipo: "nota", texto: t.nota } : null;
};
const dataBR = (iso: string) => iso.includes("T") ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
  : /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso;
const salvar = (id: number, patch: Partial<Tarefa>) => api(`/api/tarefas/${id}`, { method: "PATCH", json: patch }).then(invalidate);

export function Tarefas() {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  const visao = (["hoje", "quadro", "frentes"].includes(sp.get("visao") ?? "") ? sp.get("visao") : "hoje") as Visao;
  const frente = sp.get("frente");
  const [quem, setQuem] = usePref<string>("tarefas.quem", "");
  const { data, error, reload } = useApi<Resp>("/api/tarefas");
  const [editar, setEditar] = useState<Tarefa | "nova" | null>(null);
  const [abertaId, setAbertaId] = useState<number | null>(null);
  const abrir = (t: Tarefa) => setAbertaId(t.id);
  const hoje = hojeISO();
  const ir = (v: Visao, f: string | null = frente) => navigate(`/tarefas?${new URLSearchParams({ ...(v !== "hoje" && { visao: v }), ...(f && { frente: f }) })}`.replace(/\?$/, ""));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "n" && !e.metaKey && !e.ctrlKey && !isTyping(e)) { e.preventDefault(); setEditar("nova"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const todas = data?.tarefas ?? [];
  const lista = todas.filter((t) => (!frente || t.frente === frente) && (!quem || t.quem === quem));
  const abertas = lista.filter((t) => t.status !== "feito");
  const atrasadas = abertas.filter((t) => t.prazo && t.prazo < hoje);

  if (error && !data) return <ErrorState title="Não foi possível carregar as tarefas" detail={error} onRetry={reload} />;
  return (
    <div className="tf">
      <PageHeader
        title={<>Tarefas <em>da operação</em></>}
        meta={data ? <>{abertas.length} abertas{atrasadas.length > 0 && <> · <span className="tf-late">{atrasadas.length} atrasada{atrasadas.length > 1 ? "s" : ""}</span></>}{frente && <> · {frente}</>}</> : "…"}
        actions={<Button variant="primary" icon={<Plus size={16} />} kbd="N" onClick={() => setEditar("nova")}>Nova tarefa</Button>}
      />
      <div className="tf-barra">
        <Segmented label="Visão" value={visao} onChange={(v) => ir(v)} options={[
          { value: "hoje", label: "Hoje", icon: <CalendarDays size={15} /> },
          { value: "quadro", label: "Quadro", icon: <Columns3 size={15} /> },
          { value: "frentes", label: "Frentes", icon: <Users size={15} /> },
        ]} />
        <select className="field tf-sel" aria-label="Frente" value={frente ?? ""} onChange={(e) => ir(visao, e.target.value || null)}>
          <option value="">Todas as frentes</option>
          {(data?.opcoes.frentes ?? []).map((f) => <option key={f}>{f}</option>)}
        </select>
        <select className="field tf-sel" aria-label="Quem faz" value={quem} onChange={(e) => setQuem(e.target.value)}>
          <option value="">Todo mundo</option>
          {(data?.opcoes.quem ?? []).map((q) => <option key={q}>{q}</option>)}
        </select>
      </div>
      <ProducaoHub frente={frente} />
      <NovaRapida frente={frente} quem={quem} />
      {!data ? <div className="tf-skel" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} ratio="8/1" />)}</div>
        : !todas.length ? <Empty title={<>Nenhuma tarefa <em>ainda</em></>} action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditar("nova")}>Nova tarefa</Button>}>Escreva o que precisa ser feito, de quem é e para quando.</Empty>
        : visao === "hoje" ? <VisaoHoje lista={lista} hoje={hoje} abrir={abrir} />
        : visao === "quadro" ? <VisaoQuadro lista={lista} hoje={hoje} abrir={abrir} />
        : <VisaoFrentes lista={lista} hoje={hoje} abrir={abrir} filtrar={(f) => ir("hoje", f)} />}
      {abertaId !== null && !editar && todas.some((t) => t.id === abertaId) && <Detalhe t={todas.find((t) => t.id === abertaId)!} hoje={hoje} onClose={() => setAbertaId(null)} onEditar={setEditar} />}
      {editar && <Editor t={editar === "nova" ? null : editar} padrao={{ frente: frente ?? "", quem: quem || "Matheus" }} opcoes={data?.opcoes} onClose={() => setEditar(null)} />}
    </div>
  );
}

/** O que a Produção do Hub já sabe, por perfil: sem digitar de novo como tarefa. */
function ProducaoHub({ frente }: { frente: string | null }) {
  const { data: pipe } = useApi<PipelineResponse>("/api/pipeline");
  const { data: cars } = useApi<CarrosselApi[]>("/api/carrosseis");
  const perfis = useMemo(() => {
    const m = new Map<string, { slug: string; nome: string; prontos: number; edicao: number; agendados: number; carrosseis: number }>();
    const de = (slug: string, nome: string) => m.get(slug) ?? (m.set(slug, { slug, nome, prontos: 0, edicao: 0, agendados: 0, carrosseis: 0 }), m.get(slug)!);
    for (const x of (pipe?.itens ?? []) as any[]) {
      const p = de(x.profile_slug ?? x.client_slug, (x.client_name ?? "").replace(/ (Loira|Morena)$/, ""));
      if (x.stage === "pronta") p.prontos++; else if (x.stage === "producao") p.edicao++; else if (x.stage === "agendada") p.agendados++;
    }
    for (const c of cars ?? []) if (c.etapa === "pronto") de(c.perfil.slug, c.perfil.name).carrosseis++;
    return [...m.values()].filter((p) => p.prontos + p.edicao + p.agendados + p.carrosseis > 0)
      .filter((p) => !frente || p.nome.toLowerCase().includes(frente.toLowerCase().split(" ")[0]));
  }, [pipe, cars, frente]);
  if (!perfis.length) return null;
  const n = (v: number, um: string, varios: string) => v ? <span>{v} {v === 1 ? um : varios}</span> : null;
  return (
    <section className="tf-prod" aria-label="Produção no Hub">
      <span className="tf-prod-t">Produção no Hub</span>
      {perfis.map((p) => (
        <a key={p.slug} href={producaoHref(p.slug)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(producaoHref(p.slug)); }} className="tf-prod-p">
          <b>{p.nome}</b>{n(p.prontos, "vídeo pronto pra postar", "vídeos prontos pra postar")}{n(p.carrosseis, "carrossel pronto", "carrosséis prontos")}{n(p.agendados, "agendado", "agendados")}{n(p.edicao, "em edição", "em edição")}
        </a>
      ))}
    </section>
  );
}

function NovaRapida({ frente, quem }: { frente: string | null; quem: string }) {
  const [titulo, setTitulo] = useState("");
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!titulo.trim()) return;
    if (await act(() => api("/api/tarefas", { method: "POST", json: { titulo, frente: frente ?? "Geral", quem: quem || "Matheus" } }).then(() => true), "Tarefa criada")) setTitulo("");
  };
  return (
    <form className="tf-rapida" onSubmit={enviar}>
      <Plus size={16} aria-hidden />
      <input className="tf-rapida-in" placeholder={`Nova tarefa${frente ? ` em ${frente}` : ""}… (Enter salva)`} aria-label="Nova tarefa" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
    </form>
  );
}

function Linha({ t, hoje, abrir, compacta }: { t: Tarefa; hoje: string; abrir: (t: Tarefa) => void; compacta?: boolean }) {
  const feito = t.status === "feito";
  const atrasada = !feito && !!t.prazo && t.prazo < hoje;
  const passos = t.passos.length ? `${t.passos.filter((p) => p.feito).length}/${t.passos.length}` : null;
  const proxima = proximaAcao(t);
  return (
    <li className={cx("tf-linha", feito && "is-feito", compacta && "is-compacta")} draggable onDragStart={(e) => e.dataTransfer.setData("text/tarefa", String(t.id))}>
      <button type="button" className="tf-check" aria-label={feito ? `Reabrir ${t.titulo}` : `Concluir ${t.titulo}`} aria-pressed={feito}
        onClick={() => act(() => salvar(t.id, { status: feito ? "a_fazer" : "feito" }), feito ? "Reaberta" : "Feito ✓", () => salvar(t.id, { status: t.status }))}>
        {feito && <Check size={13} strokeWidth={2.5} />}
      </button>
      <button type="button" className="tf-corpo" onClick={() => abrir(t)}>
        <span className="tf-titulo">{t.hora && t.prazo === hoje && !feito && <span className="tf-hora num">{t.hora}</span>}{t.urgente && !feito && <Flag size={13} className="tf-flag" aria-label="Urgente" />}{t.titulo}</span>
        {proxima && <span className={cx("tf-proxima", `is-${proxima.tipo}`)}>{proxima.tipo === "trava" && <b>Travada · </b>}{proxima.tipo === "passo" && <b>Próximo · </b>}{proxima.texto}</span>}
        <span className="tf-meta">
          <span>{t.frente}</span><span>{t.quem}</span>
          {t.prazo && <span className={cx(atrasada && "tf-late")}>{atrasada ? "atrasada · " : ""}{dataCurta(t.prazo, hoje)}{t.hora && t.prazo !== hoje ? ` ${t.hora}` : ""}</span>}
          {t.status === "fazendo" && !compacta && <span className="tf-st">fazendo</span>}
          {t.status === "esperando" && !compacta && <span className="tf-st is-wait">esperando</span>}
          {passos && <span className="num">{passos}</span>}
        </span>
      </button>
      <MoreMenu label={`Mover ${t.titulo}`} items={[
        ...COLUNAS.filter((c) => c.s !== t.status).map((c) => ({ label: `Mover para ${c.label}`, onSelect: () => act(() => salvar(t.id, { status: c.s })) })),
        { label: t.urgente ? "Tirar urgência" : "Marcar como urgente", onSelect: () => act(() => salvar(t.id, { urgente: !t.urgente })) },
        { label: "Para amanhã", onSelect: () => act(() => salvar(t.id, { prazo: maisDias(hoje, 1) }), "Prazo: amanhã") },
      ]} />
    </li>
  );
}

function Grupo({ titulo, lista, hoje, abrir, tom, fechado, vazio }: { titulo: string; lista: Tarefa[]; hoje: string; abrir: (t: Tarefa) => void; tom?: "late" | "wait"; fechado?: boolean; vazio?: string }) {
  if (!lista.length && !vazio) return null;
  const corpo = lista.length ? <ul className="tf-lista">{lista.map((t) => <Linha key={t.id} t={t} hoje={hoje} abrir={abrir} />)}</ul> : <p className="tf-vazio">{vazio}</p>;
  const h = <><span className={cx("tf-gt", tom && `is-${tom}`)}>{titulo}</span><span className="num tf-gn">{lista.length}</span></>;
  return fechado
    ? <details className="tf-grupo"><summary>{h}</summary>{corpo}</details>
    : <section className="tf-grupo"><h2>{h}</h2>{corpo}</section>;
}

function VisaoHoje({ lista, hoje, abrir }: { lista: Tarefa[]; hoje: string; abrir: (t: Tarefa) => void }) {
  const abertas = lista.filter((t) => t.status !== "feito");
  const semana = maisDias(hoje, 7);
  const atrasadas = abertas.filter((t) => t.prazo && t.prazo < hoje && t.status !== "esperando");
  const esperando = abertas.filter((t) => t.status === "esperando");
  const agora = abertas.filter((t) => !atrasadas.includes(t) && t.status !== "esperando" && (t.prazo === hoje || t.status === "fazendo" || (t.urgente && (!t.prazo || t.prazo <= hoje))))
    .sort((a, b) => (a.prazo === hoje && a.hora ? a.hora : "99") .localeCompare(b.prazo === hoje && b.hora ? b.hora : "99"));
  const proximos = abertas.filter((t) => t.status !== "esperando" && !agora.includes(t) && t.prazo && t.prazo > hoje && t.prazo <= semana);
  const semData = abertas.filter((t) => t.status !== "esperando" && !agora.includes(t) && !t.prazo);
  const depois = abertas.filter((t) => t.status !== "esperando" && !agora.includes(t) && t.prazo && t.prazo > semana);
  const feitas = lista.filter((t) => t.status === "feito" && (t.feito_em ?? "") >= maisDias(hoje, -2)).sort((a, b) => (b.feito_em ?? "").localeCompare(a.feito_em ?? ""));
  return (
    <div className="tf-hoje">
      <div className="tf-col-main">
        <Grupo titulo="Atrasadas" tom="late" lista={atrasadas} hoje={hoje} abrir={abrir} />
        <Grupo titulo={`Hoje · ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}`} lista={agora} hoje={hoje} abrir={abrir} vazio="Nada marcado pra hoje. Puxe algo dos próximos dias." />
        <Grupo titulo="Próximos 7 dias" lista={proximos} hoje={hoje} abrir={abrir} />
        <Grupo titulo="Sem data" lista={semData} hoje={hoje} abrir={abrir} fechado />
        <Grupo titulo="Mais pra frente" lista={depois} hoje={hoje} abrir={abrir} fechado />
      </div>
      <div className="tf-col-side">
        <Grupo titulo="Esperando alguém" tom="wait" lista={esperando} hoje={hoje} abrir={abrir} vazio="Ninguém travando nada." />
        <Grupo titulo="Feitas (últimos 3 dias)" lista={feitas} hoje={hoje} abrir={abrir} fechado />
      </div>
    </div>
  );
}

function VisaoQuadro({ lista, hoje, abrir }: { lista: Tarefa[]; hoje: string; abrir: (t: Tarefa) => void }) {
  const [alvo, setAlvo] = useState<StatusTarefa | null>(null);
  const soltar = (s: StatusTarefa) => (e: DragEvent) => {
    e.preventDefault(); setAlvo(null);
    const id = Number(e.dataTransfer.getData("text/tarefa"));
    const t = lista.find((x) => x.id === id);
    if (t && t.status !== s) act(() => salvar(id, { status: s }), `Movida para ${LABEL[s]}`, () => salvar(id, { status: t.status }));
  };
  return (
    <div className="tf-quadro">
      {COLUNAS.map((c) => {
        const ts = lista.filter((t) => t.status === c.s);
        return (
          <section key={c.s} className={cx("tf-coluna", alvo === c.s && "is-alvo")} aria-label={c.label}
            onDragOver={(e) => { e.preventDefault(); setAlvo(c.s); }} onDragLeave={() => setAlvo(null)} onDrop={soltar(c.s)}>
            <h2><span className={cx("tf-gt", c.s === "esperando" && "is-wait")}>{c.label}</span><span className="num tf-gn">{ts.length}</span></h2>
            {ts.length ? <ul className="tf-lista">{ts.map((t) => <Linha key={t.id} t={t} hoje={hoje} abrir={abrir} compacta />)}</ul> : <p className="tf-vazio">Arraste uma tarefa pra cá.</p>}
          </section>
        );
      })}
    </div>
  );
}

function VisaoFrentes({ lista, hoje, abrir, filtrar }: { lista: Tarefa[]; hoje: string; abrir: (t: Tarefa) => void; filtrar: (f: string) => void }) {
  const frentes = [...new Set(lista.map((t) => t.frente))].map((f) => {
    const abertas = lista.filter((t) => t.frente === f && t.status !== "feito");
    return { f, abertas, atrasadas: abertas.filter((t) => t.prazo && t.prazo < hoje).length, esperando: abertas.filter((t) => t.status === "esperando").length };
  }).filter((x) => x.abertas.length).sort((a, b) => b.atrasadas - a.atrasadas || b.abertas.length - a.abertas.length);
  if (!frentes.length) return <Empty title="Tudo feito">Nenhuma tarefa aberta nesse filtro.</Empty>;
  return (
    <div className="tf-frentes">
      {frentes.map(({ f, abertas, atrasadas, esperando }) => (
        <article key={f} className="tf-frente">
          <header>
            <button type="button" className="tf-frente-nome" onClick={() => filtrar(f)}>{f}</button>
            <span className="tf-frente-n num">{abertas.length} aberta{abertas.length > 1 ? "s" : ""}{atrasadas > 0 && <span className="tf-late"> · {atrasadas} atrasada{atrasadas > 1 ? "s" : ""}</span>}{esperando > 0 && <span className="tf-wait"> · {esperando} esperando</span>}</span>
          </header>
          <ul className="tf-lista">{abertas.slice(0, 5).map((t) => <Linha key={t.id} t={t} hoje={hoje} abrir={abrir} compacta />)}</ul>
          {abertas.length > 5 && <button type="button" className="tf-mais" onClick={() => filtrar(f)}>+ {abertas.length - 5} tarefas</button>}
        </article>
      ))}
    </div>
  );
}

/** Leitura da tarefa: responde qual a entrega, onde está, o que falta, o que trava e de onde veio. */
function Detalhe({ t, hoje, onClose, onEditar }: { t: Tarefa; hoje: string; onClose: () => void; onEditar: (t: Tarefa) => void }) {
  const feito = t.status === "feito";
  const atrasada = !feito && !!t.prazo && t.prazo < hoje;
  const travas = t.depende.filter((d) => d.trava);
  const depois = t.depende.filter((d) => !d.trava);
  const links = [...t.links, ...(t.link && !t.links.some((l) => l.url === t.link) ? [{ label: t.link.startsWith("/") ? "Abrir no Hub" : "Link", url: t.link }] : [])];
  // Marca na hora; a resposta do servidor só confirma.
  const [passos, setPassos] = useState(t.passos);
  useEffect(() => setPassos(t.passos), [t.passos]);
  const marcarPasso = (i: number, marcado: boolean) => {
    const novos = passos.map((p, j) => j === i ? { ...p, feito: marcado } : p);
    setPassos(novos);
    act(() => salvar(t.id, { passos: novos }));
  };
  const vazio = !t.entrega && !t.nota && !t.contexto && !t.passos.length && !t.depende.length && !t.origem;
  return (
    <Modal title={<>{t.codigo} <em>· {t.frente}</em></>} onClose={onClose} width={720}
      footer={<>
        <Button variant="ghost" icon={<Pencil size={15} />} className="mr-auto" onClick={() => onEditar(t)}>Editar</Button>
        <Button variant="ghost" onClick={onClose}>Fechar</Button>
        <Button variant={feito ? "ghost" : "primary"} icon={feito ? undefined : <Check size={15} />} onClick={() => act(() => salvar(t.id, { status: feito ? "a_fazer" : "feito" }), feito ? "Reaberta" : "Feito ✓")}>{feito ? "Reabrir" : "Concluir"}</Button>
      </>}>
      <div className="tf-det">
        <h3 className="tf-det-t">{t.urgente && !feito && <Flag size={15} className="tf-flag" aria-label="Urgente" />}{t.titulo}</h3>
        <dl className="tf-det-ficha">
          <div><dt>Situação</dt><dd>
            <select className="field tf-det-st" aria-label="Situação" value={t.status} onChange={(e) => act(() => salvar(t.id, { status: e.target.value as StatusTarefa }))}>{COLUNAS.map((c) => <option key={c.s} value={c.s}>{c.label}</option>)}</select>
          </dd></div>
          <div><dt>Quem faz</dt><dd>{t.quem}</dd></div>
          <div><dt>Prazo</dt><dd className={cx(atrasada && "tf-late")}>{t.prazo ? `${atrasada ? "atrasada · " : ""}${dataCurta(t.prazo, hoje)}${t.hora ? ` ${t.hora}` : ""}` : "sem data"}</dd></div>
          <div><dt>Atualizada</dt><dd>{dataBR(t.atualizado_em)}</dd></div>
        </dl>
        {t.desfecho && <p className="tf-det-desfecho"><b>Como encerrou:</b> {t.desfecho}</p>}
        {travas.length > 0 && <section className="tf-det-alerta"><h4>O que trava</h4><ul>{travas.map((d, i) => <li key={i}>{d.quem && <b>{d.quem}: </b>}{d.oque}</li>)}</ul></section>}
        {t.entrega && <section className="tf-det-s"><h4>A entrega</h4><p>{t.entrega}</p></section>}
        {t.nota && <section className="tf-det-s"><h4>Onde está</h4><p>{t.nota}</p></section>}
        {passos.length > 0 && (
          <section className="tf-det-s">
            <h4>Passos <span className="num tf-gn">{passos.filter((p) => p.feito).length}/{passos.length}</span></h4>
            <ul className="tf-det-passos">{passos.map((p, i) => <li key={i}><label className={cx(p.feito && "is-ok")}><input type="checkbox" checked={p.feito} onChange={(e) => marcarPasso(i, e.target.checked)} /><span>{p.t}</span></label></li>)}</ul>
          </section>
        )}
        {depois.length > 0 && <section className="tf-det-s"><h4>Vai precisar depois</h4><ul className="tf-det-lista">{depois.map((d, i) => <li key={i}>{d.quem && <b>{d.quem}: </b>}{d.oque}</li>)}</ul></section>}
        {t.contexto && <section className="tf-det-s"><h4>Contexto</h4><p>{t.contexto}</p></section>}
        {(t.origem || t.trecho) && (
          <section className="tf-det-s">
            <h4>De onde veio</h4>
            {t.trecho && <blockquote className="tf-det-trecho">{t.trecho}</blockquote>}
            {t.origem && <p className="tf-det-origem">{t.origem}</p>}
          </section>
        )}
        {links.length > 0 && (
          <section className="tf-det-s"><h4>Links</h4><ul className="tf-det-links">{links.map((l, i) => (
            <li key={i}><a href={l.url} target={l.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" onClick={(e) => { if (l.url.startsWith("/") && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onClose(); navigate(l.url); } }}><ExternalLink size={13} aria-hidden /> {l.label || l.url}</a></li>
          ))}</ul></section>
        )}
        {t.historico.length > 0 && (
          <details className="tf-det-hist">
            <summary>Histórico <span className="num tf-gn">{t.historico.length}</span></summary>
            <ol>{[...t.historico].reverse().map((e, i) => <li key={i}><span className="num">{dataBR(e.d)}</span><span>{e.quem && <b>{e.quem}: </b>}{e.oque}</span></li>)}</ol>
          </details>
        )}
        {vazio && <p className="tf-vazio">Essa tarefa ainda não tem contexto. Use Editar para escrever a entrega e o que falta.</p>}
      </div>
    </Modal>
  );
}

function Editor({ t, padrao, opcoes, onClose }: { t: Tarefa | null; padrao: { frente: string; quem: string }; opcoes?: Resp["opcoes"]; onClose: () => void }) {
  const [v, setV] = useState(() => t ? { ...t, prazo: t.prazo ?? "", hora: t.hora ?? "" } : { titulo: "", frente: padrao.frente || "Geral", quem: padrao.quem, status: "a_fazer" as StatusTarefa, prazo: "", hora: "", urgente: false, nota: "", link: "", origem: "", passos: [] as Tarefa["passos"], entrega: "", contexto: "", trecho: "", depende: [] as Dependencia[], desfecho: "" });
  const [novoPasso, setNovoPasso] = useState("");
  const [busy, setBusy] = useState(false);
  const passoRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((s) => ({ ...s, [k]: x }));
  const enviar = async (e?: FormEvent) => {
    e?.preventDefault();
    const passos = novoPasso.trim() ? [...v.passos, { t: novoPasso.trim(), feito: false }] : v.passos;
    const json = { titulo: v.titulo, frente: v.frente, quem: v.quem, status: v.status, prazo: v.prazo || null, hora: v.hora || null, urgente: v.urgente, nota: v.nota, link: v.link, origem: v.origem, passos, entrega: v.entrega, contexto: v.contexto, trecho: v.trecho, depende: v.depende, desfecho: v.desfecho };
    setBusy(true);
    const ok = await act(() => (t ? api(`/api/tarefas/${t.id}`, { method: "PATCH", json }) : api("/api/tarefas", { method: "POST", json })).then(() => true), t ? "Tarefa salva" : "Tarefa criada");
    setBusy(false);
    if (ok !== undefined) onClose();
  };
  const apagar = async () => { if (t && confirm(`Apagar "${t.titulo}"?`) && (await act(() => api(`/api/tarefas/${t.id}`, { method: "DELETE" }).then(() => true), "Tarefa apagada")) !== undefined) onClose(); };
  const linkInterno = v.link.startsWith("/");
  return (
    <Modal title={t ? <>{t.codigo} <em>· editar</em></> : <>Nova <em>tarefa</em></>} onClose={onClose} width={680}
      footer={<>
        {t && <Button variant="ghost" icon={<Trash2 size={15} />} className="mr-auto" onClick={apagar}>Apagar</Button>}
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" type="submit" form="tf-form" busy={busy} disabledReason={v.titulo.trim() ? undefined : "Escreva o que precisa ser feito"}>{t ? "Salvar" : "Criar"}</Button>
      </>}>
      <form id="tf-form" className="tf-form" onSubmit={enviar}>
        <Field label="O que precisa ser feito"><textarea className="field" rows={2} autoFocus value={v.titulo} onChange={(e) => set("titulo", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} /></Field>
        <div className="tf-form-grid">
          <Field label="Frente"><input className="field" list="tf-frentes" value={v.frente} onChange={(e) => set("frente", e.target.value)} /></Field>
          <Field label="Quem faz"><input className="field" list="tf-quem" value={v.quem} onChange={(e) => set("quem", e.target.value)} /></Field>
          <Field label="Prazo"><input className="field num" type="date" value={v.prazo} onChange={(e) => set("prazo", e.target.value)} /></Field>
          <Field label="Hora"><input className="field num" type="time" value={v.hora} onChange={(e) => set("hora", e.target.value)} /></Field>
          <Field label="Situação"><select className="field" value={v.status} onChange={(e) => set("status", e.target.value as StatusTarefa)}>{COLUNAS.map((c) => <option key={c.s} value={c.s}>{c.label}</option>)}</select></Field>
        </div>
        <Field label="A entrega" hint="O que existe quando estiver pronto: peça, quantidade, destino."><textarea className="field" rows={2} value={v.entrega} onChange={(e) => set("entrega", e.target.value)} /></Field>
        <label className="tf-urg"><input type="checkbox" checked={v.urgente} onChange={(e) => set("urgente", e.target.checked)} /> Urgente</label>
        <fieldset className="tf-passos">
          <legend>Passos</legend>
          {v.passos.map((p, i) => (
            <div key={i} className="tf-passo">
              <input type="checkbox" aria-label={`Passo ${i + 1} feito`} checked={p.feito} onChange={(e) => set("passos", v.passos.map((x, j) => j === i ? { ...x, feito: e.target.checked } : x))} />
              <input className="field" value={p.t} aria-label={`Passo ${i + 1}`} onChange={(e) => set("passos", v.passos.map((x, j) => j === i ? { ...x, t: e.target.value } : x))} />
              <Button size="sm" variant="ghost" aria-label={`Tirar passo ${i + 1}`} onClick={() => set("passos", v.passos.filter((_, j) => j !== i))}>Tirar</Button>
            </div>
          ))}
          <input ref={passoRef} className="field" placeholder="Novo passo… (Enter adiciona)" value={novoPasso} onChange={(e) => setNovoPasso(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (novoPasso.trim()) { set("passos", [...v.passos, { t: novoPasso.trim(), feito: false }]); setNovoPasso(""); } } }} />
        </fieldset>
        <fieldset className="tf-passos">
          <legend>Depende de</legend>
          {v.depende.map((d, i) => (
            <div key={i} className="tf-dep">
              <input className="field" placeholder="Quem" aria-label={`Quem, dependência ${i + 1}`} value={d.quem} onChange={(e) => set("depende", v.depende.map((x, j) => j === i ? { ...x, quem: e.target.value } : x))} />
              <input className="field" placeholder="O quê" aria-label={`O quê, dependência ${i + 1}`} value={d.oque} onChange={(e) => set("depende", v.depende.map((x, j) => j === i ? { ...x, oque: e.target.value } : x))} />
              <select className="field" aria-label={`Quando interfere, dependência ${i + 1}`} value={d.trava ? "trava" : "depois"} onChange={(e) => set("depende", v.depende.map((x, j) => j === i ? { ...x, trava: e.target.value === "trava" } : x))}>
                <option value="trava">Trava o início</option><option value="depois">Só depois</option>
              </select>
              <Button size="sm" variant="ghost" aria-label={`Tirar dependência ${i + 1}`} onClick={() => set("depende", v.depende.filter((_, j) => j !== i))}>Tirar</Button>
            </div>
          ))}
          <div><Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => set("depende", [...v.depende, { quem: "", oque: "", trava: true }])}>Adicionar dependência</Button></div>
        </fieldset>
        <Field label="Onde está" hint="Situação de agora: o que já foi feito e o que falta."><textarea className="field" rows={3} value={v.nota} onChange={(e) => set("nota", e.target.value)} /></Field>
        <Field label="Contexto" hint="Por que importa e o que ajuda a decidir."><textarea className="field" rows={3} value={v.contexto} onChange={(e) => set("contexto", e.target.value)} /></Field>
        {v.status === "feito" && <Field label="Como encerrou" hint="Só quando não foi feita do jeito previsto (ex.: substituída)."><input className="field" value={v.desfecho} onChange={(e) => set("desfecho", e.target.value)} /></Field>}
        <Field label="Trecho da fonte" hint="A frase de quem pediu, entre aspas."><textarea className="field" rows={2} value={v.trecho} onChange={(e) => set("trecho", e.target.value)} /></Field>
        <div className="tf-form-grid">
          <Field label="Link" hint={v.link ? (linkInterno ? <a href={v.link} onClick={(e) => { e.preventDefault(); onClose(); navigate(v.link); }}>Abrir no Hub</a> : /^https?:/.test(v.link) ? <a href={v.link} target="_blank" rel="noreferrer">Abrir ↗</a> : null) : "Página do Hub, site ou doc."}>
            <input className="field" value={v.link} onChange={(e) => set("link", e.target.value)} />
          </Field>
          <Field label="De onde veio" hint="Grupo do WhatsApp ou call, com a data."><input className="field" value={v.origem} onChange={(e) => set("origem", e.target.value)} /></Field>
        </div>
        <datalist id="tf-frentes">{(opcoes?.frentes ?? []).map((f) => <option key={f} value={f} />)}</datalist>
        <datalist id="tf-quem">{[...new Set(["Matheus", "Claude", ...(opcoes?.quem ?? [])])].map((q) => <option key={q} value={q} />)}</datalist>
      </form>
    </Modal>
  );
}

export const TarefasIcon = ListTodo;
