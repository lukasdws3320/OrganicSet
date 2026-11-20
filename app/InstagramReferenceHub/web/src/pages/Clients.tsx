import { CalendarClock, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { act, api, apiUrl, fmtDate, fmtDateTime, media, navigate, plural, useApi, useLocation } from "../lib";
import { Button, ButtonLink, Chip, cx, Empty, ErrorState, Field, Modal, PageHeader, Segmented, Skeleton } from "../ui";
import { LifecycleBar } from "../components/LifecycleBar";
import { StageBadge } from "../components/StageBadge";
import type { PipelineResponse, Profile, Stage } from "../../../server/types";
import {
  EXPERT_ABAS, expertAba, expertHref, findProfile, sugerirPerfil, personagemCurto, producaoHref, profileOfClient, rotasNovas,
  TIPO_LABEL, type ExpertAba, type ExpertNaoEncontrado,
} from "../replication-experts";
import { estudioHref } from "../replication-experts";
import { Library } from "./Library";
import { ExpertNaoEncontradoState, Producao } from "./Replicacoes";
import "../replication-studio.css";

const SWATCHES = ["#EE794E", "#C8DDD2", "#AFC2ED", "#C1AFE0", "#E9C46A", "#A3A3A3"];
const go = (to: string) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); };
const iniciais = (n: string) => n.split(/\s+/).filter((w) => w.length > 2 || /^[A-ZÀ-Ú]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const ABA_LABEL: Record<ExpertAba, string> = { visao: "Visão", producao: "Produção", postagens: "Postagens", referencias: "Referências", identidade: "Identidade" };
type Cliente = { id: number; name: string; segment?: string; color?: string; notes?: string; avatar?: string; genero?: string; avatar_estilo?: string; cover?: string | null; ref_count?: number };

// =====================================================================
// Experts (SPEC §5.2): lista de PERFIS; o perfil agrupa personagens
// =====================================================================

export function Experts() {
  const profilesQ = useApi<Profile[]>(apiUrl.profiles());
  const clientsQ = useApi<Cliente[]>("/api/clients");
  const loc = useLocation();
  const [form, setForm] = useState<any | null>(() => (new URLSearchParams(loc.search).get("nova") ? {} : null));
  const [historico, setHistorico] = useState(false);
  const profiles = profilesQ.data?.filter(p => historico || p.ativo !== false);
  const capa = (p: Profile) => p.personagens.map((c) => clientsQ.data?.find((x) => x.id === c.id)?.cover).find(Boolean) ?? null;
  return (
    <div className="ex">
      <PageHeader
        title={<>Ex<em>perts</em></>}
        meta={profiles ? `${plural(profiles.length, "perfil", "perfis")} · ${plural(profiles.reduce((n, p) => n + p.personagens.length, 0), "personagem", "personagens")} · uma referência pode servir a vários, sem duplicar o arquivo` : "Carregando…"}
        actions={<><Button variant="ghost" onClick={() => setHistorico(v => !v)}>{historico ? "Só ativos" : "Incluir inativos"}</Button><Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setForm({})}>Novo expert</Button></>}
      />
      {profilesQ.error && !profiles && <ErrorState title="Não foi possível ler os perfis" detail={profilesQ.error} onRetry={profilesQ.reload} />}
      {!profiles && !profilesQ.error && <div className="ex-grid" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} ratio="16/7" />)}</div>}
      {profiles && !profiles.length && (
        <Empty title={<>Nenhum expert <em>ainda</em></>} action={<Button variant="primary" onClick={() => setForm({})}>Cadastrar expert</Button>}>
          Expert = qualquer especialista com conteúdo, inclusive os criados por você para uma operação própria. Cada um tem segmento, cor, avatar (contact sheet) e categorias.
        </Empty>
      )}
      {profiles && profiles.length > 0 && (
        <ul className="ex-grid">
          {profiles.map((p) => {
            const href = expertHref(p);
            const cover = capa(p);
            return (
              <li key={p.id}>
                <article className="ex-card">
                  <div className="ex-card-m img-outline">{cover ? <img src={media(cover)} alt="" loading="lazy" /> : <span aria-hidden>{iniciais(p.name)}</span>}</div>
                  <div className="ex-card-b">
                    <p className="ex-tipo">{TIPO_LABEL[p.tipo]}{p.ativo === false ? " · Inativo" : ""}</p>
                    <h2><a href={href} onClick={go(href)} className="ex-card-a">{p.name}</a></h2>
                    <p className="ex-pers">
                      {p.personagens.length > 1
                        ? <>{p.personagens.length} personagens: {p.personagens.map((c) => personagemCurto(p.name, c.name)).join(" · ")}</>
                        : <>Personagem: {p.personagens[0]?.name ?? "—"}</>}
                    </p>
                    <Fatos className="ex-counts num" itens={[plural(p.ref_count, "referência atribuída", "referências atribuídas"), plural(p.replicacoes, "replicação", "replicações")]} />
                    <LifecycleBar counts={stagesOf(p)} order={["atribuida", "producao", "pronta", "agendada", "postada"]} legend={false} className="ex-lc" />
                    <Fatos className="ex-lc-t num" itens={resumoEstagios(p)} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {form && <ClientForm client={form} onClose={() => { setForm(null); if (loc.search) navigate(location.pathname, { replace: true }); }} />}
    </div>
  );
}

const stagesOf = (p: Profile): Partial<Record<Stage, number>> => ({ atribuida: p.stages.atribuida, producao: p.stages.producao + (p.stages.analise ?? 0), pronta: p.stages.pronta, agendada: p.stages.agendada, postada: p.stages.postada });
function resumoEstagios(p: Profile): string[] {
  const s = stagesOf(p);
  const parts = ([["producao", "em produção"], ["pronta", "prontas"], ["agendada", "agendadas"], ["postada", "postadas"]] as const).map(([k, l]) => `${s[k] ?? 0} ${l}`);
  return parts;
}

/** Linha de números: cada fato é indivisível (número + rótulo) e quebra de linha sem deixar "·" solto. */
function Fatos({ itens, className }: { itens: string[]; className: string }) {
  return <p className={`${className} flex flex-wrap gap-x-3 gap-y-0.5`}>{itens.map((t) => <span key={t} className="whitespace-nowrap">{t}</span>)}</p>;
}

/** /experts/:slug/:aba (rotas novas) — perfil por slug, alias ou personagem. */
export function ExpertPage({ slug, aba: abaProp }: { slug: string; aba?: ExpertAba | string }) {
  const profilesQ = useApi<Profile[]>(apiUrl.profiles());
  const clientsQ = useApi<Cliente[]>("/api/clients");
  const loc = useLocation();
  const aba = expertAba(abaProp ?? new URLSearchParams(loc.search).get("aba"));
  const perfil = findProfile(profilesQ.data, slug);
  const [naoAchou, setNaoAchou] = useState<{ slug: string; info: ExpertNaoEncontrado } | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [excluir, setExcluir] = useState<Cliente | null>(null);
  // Slug desconhecido: o Hub sugere o perfil certo (404 de /api/pipeline com `sugestao`).
  useEffect(() => {
    if (!profilesQ.data || perfil || naoAchou?.slug === slug) return;
    setNaoAchou({ slug, info: { codigo: "expert_nao_encontrado", slug, sugestao: sugerirPerfil(profilesQ.data, slug) } });
  }, [profilesQ.data, perfil, slug]);
  if (profilesQ.error && !profilesQ.data) return <ErrorState title="Não foi possível ler os perfis" detail={profilesQ.error} onRetry={profilesQ.reload} />;
  if (!profilesQ.data) return <div className="ex-grid" aria-busy="true"><Skeleton ratio="16/7" /></div>;
  if (!perfil) {
    return naoAchou?.slug === slug
      ? <ExpertNaoEncontradoState info={naoAchou.info} href={(s) => { const p = findProfile(profilesQ.data, s); return p ? expertHref(p) : "/experts"; }} todos={{ label: "Ver todos os experts", href: "/experts" }} />
      : <div className="ex-grid" aria-busy="true"><Skeleton ratio="16/7" /></div>;
  }
  const clientes = perfil.personagens.map((c) => clientsQ.data?.find((x) => x.id === c.id)).filter(Boolean) as Cliente[];
  const trocar = (a: ExpertAba) => navigate(expertHref(perfil, a), { replace: true });
  return (
    <div className="ex">
      <a href="/experts" onClick={go("/experts")} className="ex-back">← Experts</a>
      <header className="ex-head">
        <div className="min-w-0">
          <p className="ex-tipo">{TIPO_LABEL[perfil.tipo]}{perfil.instagram && <> · <span className="num">@{perfil.instagram.replace(/^@/, "")}</span></>}</p>
          <h1 className="title-serif">{perfil.name}</h1>
          <Fatos className="ex-counts num" itens={[plural(perfil.ref_count, "referência atribuída", "referências atribuídas"), plural(perfil.replicacoes, "replicação", "replicações"), ...(perfil.personagens.length > 1 ? [`${perfil.personagens.length} personagens`] : [])]} />
          {perfil.aliases.length > 0 && <p className="ex-alias num">também conhecido como {perfil.aliases.join(", ")}</p>}
        </div>
        <div className="ex-head-acts">
          {perfil.painel_slug && <ButtonLink href={`https://clientes.matheusmarcolino.com/dashboard/${perfil.painel_slug}/`} external icon={<ExternalLink size={15} />}>Dashboard público</ButtonLink>}
          <ButtonLink variant="primary" href={producaoHref(perfil.slug)} onClick={go(producaoHref(perfil.slug))}>Abrir produção</ButtonLink>
        </div>
      </header>
      <div className="ex-tabs" role="tablist" aria-label="Seções do expert">
        {EXPERT_ABAS.map((a) => (
          <a key={a} role="tab" aria-selected={a === aba} href={expertHref(perfil, a)} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); trocar(a); }}>{ABA_LABEL[a]}</a>
        ))}
      </div>
      <div role="tabpanel" aria-label={ABA_LABEL[aba]}>
        {aba === "visao" && <Visao perfil={perfil} clientes={clientes} />}
        {aba === "producao" && <Producao expert={perfil.slug} visao={new URLSearchParams(loc.search).get("visao")} embedded />}
        {aba === "postagens" && <Postagens perfil={perfil} />}
        {aba === "referencias" && <Referencias perfil={perfil} />}
        {aba === "identidade" && <Identidade perfil={perfil} clientes={clientes} onEdit={(c) => setEdit(c)} onDelete={(c) => setExcluir(c)} />}
      </div>
      {edit && <ClientForm client={edit} onClose={() => setEdit(null)} />}
      {excluir && (
        <Modal title={<>Excluir <em>{excluir.name}</em>?</>} onClose={() => setExcluir(null)}
          footer={<><Button variant="ghost" onClick={() => setExcluir(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { if (await act(() => api(`/api/clients/${excluir.id}`, { method: "DELETE" }), "Personagem excluído")) { setExcluir(null); navigate("/experts"); } }}>Excluir personagem</Button></>}>
          <p className="text-[14px] text-ink-2">O personagem sai do cadastro. As referências e os vídeos continuam na biblioteca, só perdem a associação. As pastas de replicação não são apagadas.</p>
        </Modal>
      )}
    </div>
  );
}

function Visao({ perfil, clientes }: { perfil: Profile; clientes: Cliente[] }) {
  const pipe = useApi<PipelineResponse>(apiUrl.pipeline(perfil.slug));
  const itens = pipe.data?.itens ?? [];
  const prontasSemData = itens.filter((i) => i.stage === "pronta" && !i.agendado_para).length;
  const atrasadas = itens.filter((i) => i.late).length;
  const postados = itens.filter((i) => i.stage === "postada" || i.stage === "agendada").sort((a, b) => (b.postado_em ?? b.agendado_para ?? "").localeCompare(a.postado_em ?? a.agendado_para ?? "")).slice(0, 6);
  return (
    <div className="ex-visao">
      <section className="ex-sec">
        <h2 className="ex-sec-h">Ciclo</h2>
        <LifecycleBar counts={stagesOf(perfil)} order={["atribuida", "producao", "pronta", "agendada", "postada"]} />
        <ul className="ex-next">
          {atrasadas > 0 && <li><StageBadge stage="atrasada" label={`${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"}`} /> <a href={producaoHref(perfil.slug, "lista")} onClick={go(producaoHref(perfil.slug, "lista"))}>Ver na lista</a></li>}
          {prontasSemData > 0 && <li><StageBadge stage="pronta" label={`${prontasSemData} ${prontasSemData === 1 ? "pronta sem data" : "prontas sem data"}`} /> <a href={producaoHref(perfil.slug, "lista")} onClick={go(producaoHref(perfil.slug, "lista"))}>Agendar</a></li>}
          {perfil.stages.atribuida > 0 && <li><StageBadge stage="atribuida" label={`${perfil.stages.atribuida} ${perfil.stages.atribuida === 1 ? "referência atribuída" : "referências atribuídas"} sem replicação`} /> <a href={producaoHref(perfil.slug)} onClick={go(producaoHref(perfil.slug))}>Ver no quadro</a></li>}
          {!atrasadas && !prontasSemData && !perfil.stages.atribuida && <li className="text-ink-3">Nada pendente na produção.</li>}
        </ul>
      </section>
      <section className="ex-sec">
        <h2 className="ex-sec-h">{perfil.personagens.length > 1 ? "Personagens" : "Personagem"}</h2>
        <ul className="ex-pers-grid">
          {perfil.personagens.map((c) => {
            const cli = clientes.find((x) => x.id === c.id);
            return (
              <li key={c.id} className="ex-pc">
                <div className="ex-pc-m img-outline">{cli?.cover ? <img src={media(cli.cover)} alt="" loading="lazy" /> : <span aria-hidden>{iniciais(c.name)}</span>}</div>
                <div className="min-w-0">
                  <h3>{personagemCurto(perfil.name, c.name)}</h3>
                  <p className="num ex-pc-sheet">{c.avatar || "sem contact sheet"}</p>
                  <Fatos className="num ex-pc-n" itens={[plural(c.ref_count, "referência atribuída", "referências atribuídas"), plural(c.replicacoes, "replicação", "replicações")]} />
                  {cli?.segment && <p className="ex-pc-seg">{cli.segment}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      {postados.length > 0 && (
        <section className="ex-sec">
          <h2 className="ex-sec-h">Postagens recentes</h2>
          <PostGrid itens={postados} />
        </section>
      )}
    </div>
  );
}

function PostGrid({ itens }: { itens: PipelineResponse["itens"] }) {
  return (
    <ul className="ex-posts">
      {itens.map((i) => {
        const href = i.post_url ?? estudioHref(i.id, "publicacao");
        return (
          <li key={i.id}>
            <a className="ig ig--grid" href={href} {...(i.post_url ? { target: "_blank", rel: "noreferrer" } : { onClick: go(href) })} aria-label={`${i.ref} · ${i.stage === "postada" ? "postada" : "agendada"}`}>
              {i.capa_url ? <img src={i.capa_url} alt="" loading="lazy" /> : <span className="ig-poster-ph" />}
              <StageBadge stage={i.stage} label={i.stage === "postada" ? "Postada" : "Agendada"} late={i.late} />
            </a>
            <p className="num ex-post-c">{i.ref} · {i.postado_em ? fmtDate(i.postado_em).slice(0, 5) : i.agendado_para ? fmtDateTime(i.agendado_para).slice(0, 5) : ""}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Postagens({ perfil }: { perfil: Profile }) {
  const pipe = useApi<PipelineResponse>(apiUrl.pipeline(perfil.slug));
  if (pipe.error && !pipe.data) return <ErrorState title="Não foi possível ler as postagens" detail={pipe.error} onRetry={pipe.reload} />;
  if (!pipe.data) return <div className="ex-posts" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} ratio="3/4" />)}</div>;
  const itens = pipe.data.itens.filter((i) => i.stage === "postada" || i.stage === "agendada")
    .sort((a, b) => (b.postado_em ?? b.agendado_para ?? "").localeCompare(a.postado_em ?? a.agendado_para ?? ""));
  if (!itens.length) {
    const prontas = pipe.data.itens.filter((i) => i.stage === "pronta").length;
    return <Empty title={<>Nada postado <em>ainda</em></>} action={prontas ? <ButtonLink variant="primary" icon={<CalendarClock size={15} />} href={producaoHref(perfil.slug, "lista")} onClick={go(producaoHref(perfil.slug, "lista"))}>Agendar as {prontas} prontas</ButtonLink> : undefined}>Quando um post for marcado como postado ou agendado, ele aparece aqui.</Empty>;
  }
  return (
    <div className="ex-visao">
      <p className="num ex-lido">{plural(itens.filter((i) => i.stage === "postada").length, "postada", "postadas")} · {plural(itens.filter((i) => i.stage === "agendada").length, "agendada", "agendadas")} · Hub lido {fmtDateTime(pipe.data.lido_em).slice(11)}</p>
      <PostGrid itens={itens} />
    </div>
  );
}

function Referencias({ perfil }: { perfil: Profile }) {
  const [pid, setPid] = useState(String(perfil.personagens[0]?.id ?? ""));
  const id = Number(pid);
  const nome = perfil.personagens.find((c) => c.id === id)?.name ?? perfil.name;
  if (!perfil.personagens.length) return <Empty title="Sem personagem cadastrado">Cadastre um personagem para atribuir referências.</Empty>;
  return (
    <Library key={id} title={<>Referências de <em>{personagemCurto(perfil.name, nome)}</em></>} scope={{ client: id }}
      header={perfil.personagens.length > 1 ? <div className="mb-4"><Segmented label="Personagem" size="sm" value={pid} onChange={setPid} options={perfil.personagens.map((c) => ({ value: String(c.id), label: personagemCurto(perfil.name, c.name), n: c.ref_count }))} /></div> : undefined}
      emptyHint="Abra uma referência e associe este expert, ou escolha o expert na hora de importar." />
  );
}

function Identidade({ perfil, clientes, onEdit, onDelete }: { perfil: Profile; clientes: Cliente[]; onEdit: (c: any) => void; onDelete: (c: Cliente) => void }) {
  const detalhe = (c: Cliente) => <DetalheCliente key={c.id} id={c.id} titulo={personagemCurto(perfil.name, c.name)} onEdit={onEdit} onDelete={() => onDelete(c)} />;
  return <div className="ex-ident">{clientes.map(detalhe)}{!clientes.length && <Skeleton ratio="16/5" />}</div>;
}

function DetalheCliente({ id, titulo, onEdit, onDelete }: { id: number; titulo: string; onEdit: (c: any) => void; onDelete: () => void }) {
  const { data: c } = useApi<any>(`/api/clients/${id}`);
  if (!c) return <Skeleton ratio="16/5" />;
  const linha = (k: string, v: ReactNode) => <><dt>{k}</dt><dd>{v || <span className="text-ink-3">Não informado</span>}</dd></>;
  return (
    <section className="ex-sec ex-id">
      <div className="ex-id-h">
        <h2 className="ex-sec-h"><span className="ex-dot" style={{ background: c.color }} aria-hidden />{titulo}</h2>
        <div className="flex gap-2">
          <Button size="sm" icon={<Pencil size={14} strokeWidth={1.5} />} onClick={() => onEdit(c)}>Editar</Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} strokeWidth={1.5} />} onClick={onDelete}>Excluir</Button>
        </div>
      </div>
      <dl className="ex-dl">
        {linha("Nome no Hub", c.name)}
        {linha("Slug", <span className="num">{c.slug}</span>)}
        {linha("Contact sheet", c.avatar && <span className="num">{c.avatar}</span>)}
        {linha("Voz", c.genero === "mulher" ? "Mulher (ela)" : c.genero === "homem" ? "Homem (ele)" : c.genero)}
        {linha("Estilo do avatar", c.avatar_estilo === "real" ? "Pessoa real" : "Personagem 3D")}
        {linha("Segmento", c.segment)}
        {linha("Categorias", c.categories?.length ? <span className="flex flex-wrap gap-1.5">{c.categories.map((k: any) => <Chip key={k.id}>{k.name}</Chip>)}</span> : null)}
        {linha("Observações", c.notes && <span className="whitespace-pre-wrap">{c.notes}</span>)}
      </dl>
    </section>
  );
}

// =====================================================================
// Exports antigos (o App.tsx atual): wrappers finos sobre a UI nova
// =====================================================================

/** /experts */
export function Clients() {
  return <Experts />;
}

/** /experts/:id (id numérico do personagem) — abre o perfil dono, com a aba de ?aba=. */
export function ClientPage({ id }: { id: number }) {
  const profilesQ = useApi<Profile[]>(apiUrl.profiles());
  if (profilesQ.error && !profilesQ.data) return <ErrorState title="Não foi possível ler os perfis" detail={profilesQ.error} onRetry={profilesQ.reload} />;
  if (!profilesQ.data) return <div className="ex-grid" aria-busy="true"><Skeleton ratio="16/7" /></div>;
  const p = profileOfClient(profilesQ.data, id);
  if (!p) return <Empty title={<>Expert não <em>encontrado</em></>} action={<ButtonLink variant="ghost" href="/experts" onClick={go("/experts")}>Ver todos os experts</ButtonLink>}>Nenhum perfil tem o personagem <span className="num">#{id}</span>.</Empty>;
  return <ExpertPage slug={p.slug} />;
}

function ClientForm({ client, onClose }: { client: any; onClose: () => void }) {
  const categories = useApi<any[]>("/api/categories").data ?? [];
  const [v, setV] = useState({
    name: client.name ?? "", segment: client.segment ?? "", color: client.color ?? SWATCHES[0], notes: client.notes ?? "", avatar: client.avatar ?? "", genero: client.genero ?? "homem", avatar_estilo: client.avatar_estilo ?? "3d",
    categories: (client.categories ?? []).map((c: any) => c.id) as number[],
  });
  const editing = !!client.id;
  const submit = async () => {
    const res = await act(
      () => api(editing ? `/api/clients/${client.id}` : "/api/clients", { method: editing ? "PATCH" : "POST", json: v }),
      editing ? "Expert atualizado" : "Expert cadastrado",
    );
    if (res) { onClose(); if (!editing) navigate(rotasNovas() ? "/experts" : `/experts/${res.id}`); }
  };
  return (
    <Modal title={editing ? <>Editar <em>expert</em></> : <>Novo <em>expert</em></>} onClose={onClose} width={560}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field label="Nome"><input autoFocus required className="field" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Ex.: Bruno Goytacazes" /></Field>
        <Field label="Segmento de mercado"><input className="field" value={v.segment} onChange={(e) => setV({ ...v, segment: e.target.value })} placeholder="Ex.: Nutrição e emagrecimento" /></Field>
        <Field label="Cor de identificação" hint="Aparece nos chips e no dashboard para achar o expert de relance.">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button type="button" key={c} onClick={() => setV({ ...v, color: c })} aria-label={`Cor ${c}`} aria-pressed={v.color.toUpperCase() === c}
                className={cx("press size-8 rounded-full border-2", v.color.toUpperCase() === c ? "border-fg" : "border-transparent")}>
                <span className="block size-full rounded-full border border-line" style={{ background: c }} />
              </button>
            ))}
            <label className="ml-1 flex items-center gap-2 text-[13px] text-muted">
              <input type="color" value={v.color} onChange={(e) => setV({ ...v, color: e.target.value })} className="size-8 cursor-pointer rounded-full border border-line bg-transparent" />
              <span className="num">{v.color.toUpperCase()}</span>
            </label>
          </div>
        </Field>
        <Field label="Avatar (contact sheet)" hint="Nome do arquivo que você sobe no gerador junto com o frame — vira @nome nos prompts de still. Padrão: contactsheet<Nome><NN>.">
          <input className="field num" value={v.avatar} onChange={(e) => setV({ ...v, avatar: e.target.value.trim() })} placeholder="Ex.: contactsheetBrunoGoytacaz01" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Voz nos vídeos">
            <select className="field" value={v.genero} onChange={(e) => setV({ ...v, genero: e.target.value })}><option value="homem">Homem (ele)</option><option value="mulher">Mulher (ela)</option></select>
          </Field>
          <Field label="Estilo do avatar">
            <select className="field" value={v.avatar_estilo} onChange={(e) => setV({ ...v, avatar_estilo: e.target.value })}><option value="3d">Personagem 3D</option><option value="real">Pessoa real</option></select>
          </Field>
        </div>
        <Field label="Categorias de conteúdo">
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => <Chip key={c.id} active={v.categories.includes(c.id)} onClick={() => setV({ ...v, categories: v.categories.includes(c.id) ? v.categories.filter((x) => x !== c.id) : [...v.categories, c.id] })}>{c.name}</Chip>)}
          </div>
        </Field>
        <Field label="Observações"><textarea className="field" rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} placeholder="Tom de voz, oferta, restrições, o que já funcionou…" /></Field>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={!v.name.trim()}>{editing ? "Salvar alterações" : "Cadastrar expert"}</Button>
        </div>
      </form>
    </Modal>
  );
}

