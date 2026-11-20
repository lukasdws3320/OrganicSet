import { FORMAT_OPTIONS } from "../../../server/replication-formats";
import { preparationLabel } from "../../../server/replication-preparation-state";
import { AgendarModal, MarcarPostadoModal, NovaReplicacao } from "../replication";
import {
  estudioAba, estudioHref, expertHref, findProfile, sugerirPerfil, isExpertNaoEncontrado, personagemCurto, producaoHref, producaoVisao,
  TIPO_LABEL, type EstudioAba, type ExpertNaoEncontrado, type ProducaoVisao,
} from "../replication-experts";
import { fragmentLabel } from "../../../server/production-terms";
import { ReplicationStudio, FramesFolderButton } from "./ReplicationStudio";
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Archive, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Send } from "lucide-react";
import { act, api, apiUrl, arquivar, fmtDate, fmtDateTime, fmtInt, media, navigate, openRef, toast, useApi, useLocation, usePref } from "../lib";
import { Button, ButtonLink, cx, Empty, ErrorState, Modal, PageHeader, Segmented, Skeleton } from "../ui";
import { StageBadge } from "../components/StageBadge";
import { anguloTexto, FORMATOS, type ReplicacaoV2 } from "../../../server/replicacao-prompts";
import type { PipelineItem, PipelineResponse, Profile, RefCard, Stage } from "../../../server/types";
import type { PostItem } from "../../../server/posts";
import "../replication-studio.css";
import { dataCurta, stageCarrossel, subCarrossel, type CarrosselApi } from "./Carrossel";

const fileOf = (ref: string, p: string) => media(`replicacoes/${ref}/${p}`);
const fmtS = (n: number) => `${n.toFixed(1).replace(".", ",")}s`;
const go = (to: string) => (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); };

/** Busca de novo um caminho que falhou para ler o corpo do 404 "expert não encontrado" (useApi só guarda a mensagem). */
function useNaoEncontrado(path: string | null, error: string | null) {
  const [st, setSt] = useState<{ key: string; info: ExpertNaoEncontrado | null } | null>(null);
  const key = `${path}|${error}`;
  useEffect(() => {
    if (!path || !error) return;
    let alive = true;
    api(path).then(() => alive && setSt({ key, info: null })).catch((e) => { if (alive) setSt({ key, info: isExpertNaoEncontrado(e?.data) ? e.data : null }); });
    return () => { alive = false; };
  }, [key]);
  if (!path || !error) return { info: null, checking: false };
  return st?.key === key ? { info: st.info, checking: false } : { info: null, checking: true };
}

/** Estado vazio honesto (SPEC §4.12): slug desconhecido nunca vira "Nova replicação para <slug>". */
export function ExpertNaoEncontradoState({ info, href, todos }: { info: ExpertNaoEncontrado; href: (slug: string) => string; todos: { label: string; href: string } }) {
  return (
    <Empty title={<>Expert não <em>encontrado</em></>} action={<>
      {info.sugestao && <ButtonLink variant="primary" href={href(info.sugestao.slug)} onClick={go(href(info.sugestao.slug))}>Abrir {info.sugestao.name}</ButtonLink>}
      <ButtonLink variant="ghost" href={todos.href} onClick={go(todos.href)}>{todos.label}</ButtonLink>
    </>}>
      <p>O Hub não conhece <code className="num rounded-r1 bg-sunken px-1.5 py-0.5">{info.slug}</code>.</p>
      {info.sugestao && <p className="mt-1">O Hub conhece este expert como <strong>{info.sugestao.name}</strong> <span className="num text-ink-3">({info.sugestao.slug})</span>.</p>}
    </Empty>
  );
}

// =====================================================================
// Produção (SPEC §4.9 / §5.2): Quadro · Lista · Calendário, raias por perfil
// =====================================================================

type Coluna = "atribuida" | "producao" | "pronta" | "agendada" | "postada";
const COLUNAS: { id: Coluna; nome: string }[] = [
  { id: "atribuida", nome: "Atribuída" },
  { id: "producao", nome: "Em produção" },
  { id: "pronta", nome: "Pronta" },
  { id: "agendada", nome: "Agendada" },
  { id: "postada", nome: "Postada" },
];
const ORDEM: Record<string, number> = { atribuida: 0, producao: 1, pronta: 2, agendada: 3, postada: 4 };

/** Um cartão do quadro: replicação (REF × personagem) ou referência atribuída ainda sem replicação. */
type Cartao = {
  key: string; ref: string; id: string | null; coluna: Coluna; stage: Stage; sub: string; late: boolean;
  titulo: string; capa: string | null; perfil: string | null; personagem: string | null;
  clips: number; clipsTotal: number; post_url: string | null; postado_em: string | null; agendado_para: string | null;
  preparacao?: string | null;
  /** Carrossel (pasta do perfil no vault): abre a página do carrossel, não o estúdio de vídeo. */
  href?: string; carrossel?: boolean;
};

const SEM_PERFIL = "__sem-expert";

function montarCartoes(pipe: PipelineItem[], refs: RefCard[], profiles: Profile[], reps: any[]): Cartao[] {
  const byRef = new Map(refs.map((r) => [r.id, r]));
  const prep = new Map(reps.map((r) => [r.id, r.preparacao ? preparationLabel(r.preparacao) : null]));
  const nomePersonagem = (perfil: string | null, name: string) => {
    const p = profiles.find((x) => x.slug === perfil);
    return p && p.personagens.length > 1 ? personagemCurto(p.name, name) : null;
  };
  const out: Cartao[] = pipe.map((it) => {
    const r = byRef.get(it.ref);
    const coluna: Coluna = it.stage === "postada" ? "postada" : it.stage === "agendada" ? "agendada" : it.stage === "pronta" ? "pronta" : it.stage === "atribuida" ? "atribuida" : "producao";
    return {
      key: it.id, ref: it.ref, id: it.id, coluna, stage: it.stage, late: it.late,
      sub: [it.sub, it.posts && it.posts.total > 1 ? `${it.posts.postados}/${it.posts.total} no ar` : ""].filter(Boolean).join(" · "),
      titulo: r?.caption_head?.trim() || r?.formato?.name || it.formato || "Sem legenda",
      capa: it.capa_url ?? media(r?.thumb_path) ?? null, perfil: it.profile_slug, personagem: nomePersonagem(it.profile_slug, it.client_name),
      clips: it.clips, clipsTotal: it.clipsTotal, post_url: it.post_url, postado_em: it.postado_em, agendado_para: it.agendado_para,
      preparacao: prep.get(it.id) ?? null,
    };
  });
  // Atribuída = personagem associado à referência e sem replicação desse personagem (regra 5 de §3.2, por perfil).
  for (const r of refs) {
    for (const c of r.clients ?? []) {
      if (r.pipeline?.some((p) => p.client.id === c.id)) continue;
      const p = profiles.find((x) => x.personagens.some((pc) => pc.id === c.id));
      if (!p) continue;
      out.push({
        key: `${r.id}::${c.id}`, ref: r.id, id: null, coluna: "atribuida", stage: "atribuida", sub: "", late: false,
        titulo: r.caption_head?.trim() || r.formato?.name || "Sem legenda", capa: media(r.thumb_path) ?? null,
        perfil: p.slug, personagem: p.personagens.length > 1 ? personagemCurto(p.name, c.name) : null,
        clips: 0, clipsTotal: 0, post_url: null, postado_em: null, agendado_para: null,
      });
    }
  }
  // Só análise: referência segmentada sem expert (fica fora do /api/pipeline).
  for (const r of reps) {
    if (r.slug) continue;
    const ref = byRef.get(r.ref);
    out.push({
      key: r.id, ref: r.ref, id: r.id, coluna: "producao", stage: "producao", sub: "Análise", late: false,
      titulo: ref?.caption_head?.trim() || "Sem legenda", capa: media(r.capa) ?? media(ref?.thumb_path) ?? null,
      perfil: SEM_PERFIL, personagem: null, clips: 0, clipsTotal: 0, post_url: null, postado_em: null, agendado_para: null,
      preparacao: r.preparacao ? preparationLabel(r.preparacao) : null,
    });
  }
  return out;
}

function cartoesCarrossel(lista: CarrosselApi[]): Cartao[] {
  return lista.filter(c=>!c.arquivado).map((c) => {
    const stage = stageCarrossel(c);
    const dia = dataCurta(c.data);
    return {
      key: `car:${c.id}`, ref: "Carrossel", id: null, coluna: stage as Coluna, stage, late: c.late ?? false,
      sub: subCarrossel(c) + (dia && stage !== "postada" ? ` · ${dia}` : ""),
      titulo: c.titulo, capa: c.capa, perfil: c.perfil.slug, personagem: c.personagem,
      clips: 0, clipsTotal: 0, post_url: c.url, postado_em: null, agendado_para: c.agendado_para ?? null, href: `/carrossel/${c.id}`, carrossel: true,
    };
  });
}

export function Producao({ expert: expertProp, visao: visaoProp, embedded = false }: { expert?: string | null; visao?: ProducaoVisao | string | null; embedded?: boolean }) {
  const loc = useLocation();
  const sp = new URLSearchParams(loc.search);
  const expert = (expertProp === undefined ? sp.get("expert") : expertProp) || null;
  const visao = producaoVisao(visaoProp === undefined ? sp.get("visao") : visaoProp);

  const profilesQ = useApi<Profile[]>(apiUrl.profiles());
  // Slug conferido no cadastro de perfis antes de pedir a produção: desconhecido não dispara 404 à toa.
  const desconhecido = !!expert && !!profilesQ.data && !findProfile(profilesQ.data, expert);
  const pipePath = expert && !profilesQ.data && !profilesQ.error ? null : desconhecido ? null : apiUrl.pipeline(expert);
  const pipe = useApi<PipelineResponse>(pipePath);
  const naoAchou = useNaoEncontrado(pipePath, pipe.error);
  const checking = naoAchou.checking;
  const naoEncontrado: ExpertNaoEncontrado | null = desconhecido ? { codigo: "expert_nao_encontrado", slug: expert!, sugestao: sugerirPerfil(profilesQ.data, expert!) } : naoAchou.info;
  const refsQ = useApi<{ items: RefCard[] }>("/api/refs");
  const repsQ = useApi<any[]>("/api/replicacoes");
  const carQ = useApi<CarrosselApi[]>("/api/carrosseis");
  const postsQ = useApi<{ itens: PostItem[] }>(visao === "calendario" ? "/api/posts" : null);
  const pending = repsQ.data?.some((r) => r.preparacao && !["erro", "pronto"].includes(r.preparacao.status));
  useEffect(() => { if (!pending) return; const t = setInterval(() => { if (document.visibilityState === "hidden") return; repsQ.reload(); pipe.reload(); }, 4000); return () => clearInterval(t); }, [pending, repsQ.reload, pipe.reload]);

  const [nova, setNova] = useState(false);
  const profiles = profilesQ.data ?? [];
  // O perfil vem da URL; a resposta da API só vale se for do mesmo perfil (na troca, a anterior ainda está na tela).
  const perfil = findProfile(profiles, expert);
  const pipeDoFiltro = !!pipe.data && (!expert ? !pipe.data.profile : !!perfil && pipe.data.profile === perfil.slug);
  // Só monta o quadro com TODAS as fontes lidas (replicações, refs, perfis e carrosséis): antes, os carrosséis chegavam
  // depois e o filtro por expert aparecia pela metade até trocar de expert e voltar.
  const carrosseisProntos = !!carQ.data || !!carQ.error;
  const cartoes = useMemo(() => {
    if (!pipe.data || !pipeDoFiltro || !refsQ.data || !profilesQ.data || !repsQ.data || !carrosseisProntos) return null;
    const all = [...montarCartoes(pipe.data.itens, refsQ.data.items, profilesQ.data, repsQ.data), ...cartoesCarrossel(carQ.data ?? [])];
    return perfil ? all.filter((c) => c.perfil === perfil.slug) : expert ? [] : all;
  }, [pipe.data, refsQ.data, profilesQ.data, repsQ.data, carQ.data, carrosseisProntos, pipeDoFiltro, perfil, expert]);

  const setFiltro = (next: { expert?: string | null; visao?: ProducaoVisao }) => {
    const e = next.expert !== undefined ? next.expert : expert;
    const v = next.visao ?? visao;
    if (embedded) {
      const q = new URLSearchParams(loc.search);
      if (v === "quadro") q.delete("visao"); else q.set("visao", v);
      const t = q.toString();
      navigate(`${loc.path}${t ? `?${t}` : ""}`, { replace: true });
      return;
    }
    navigate(producaoHref(e, v), { replace: true });
  };

  if (naoEncontrado) {
    return (
      <div>
        {!embedded && <PageHeader title={<>Produ<em>ção</em></>} />}
        <ExpertNaoEncontradoState info={naoEncontrado} href={(s) => producaoHref(s, visao)} todos={{ label: "Ver toda a produção", href: producaoHref(null, visao) }} />
      </div>
    );
  }
  if (pipe.error && !pipe.data && !checking) return <ErrorState title="Não foi possível ler a produção" detail={pipe.error} onRetry={pipe.reload} />;
  const falhaBase = (!refsQ.data && refsQ.error) || (!repsQ.data && repsQ.error) || (!profilesQ.data && profilesQ.error);
  if (falhaBase) return <ErrorState title="Não foi possível ler a produção" detail={falhaBase} onRetry={() => { refsQ.reload(); repsQ.reload(); profilesQ.reload(); }} />;

  const reps = cartoes?.filter((c) => c.id) ?? [];
  const nCar = cartoes?.filter((c) => c.carrossel).length ?? 0;
  const n = (col: Coluna) => cartoes?.filter((c) => c.coluna === col).length ?? 0;
  const meta = cartoes ? <>
    {fmtInt(reps.length)} {reps.length === 1 ? "replicação" : "replicações"}{nCar > 0 && <> · {fmtInt(nCar)} {nCar === 1 ? "carrossel" : "carrosséis"}</>} · {fmtInt(n("atribuida"))} atribuídas sem replicação · {fmtInt(n("pronta"))} prontas · {fmtInt(n("postada"))} postadas
    {pipe.data?.lido_em && <span className="text-ink-3"> · lido {fmtDateTime(pipe.data.lido_em).slice(11)}</span>}
  </> : "Carregando…";
  const personagemInicial = perfil?.personagens.length === 1 ? String(perfil.personagens[0].id) : undefined;

  const controles = (
    <div className="pd-controls">
      <Segmented label="Visão" size="sm" value={visao} onChange={(v) => setFiltro({ visao: v })} options={[{ value: "quadro", label: "Quadro" }, { value: "lista", label: "Lista" }, { value: "calendario", label: "Calendário" }]} />
      {!embedded && profiles.length > 1 && (
        <div className="pd-scroll">
          <Segmented label="Expert" size="sm" value={perfil?.slug ?? "todos"} onChange={(v) => setFiltro({ expert: v === "todos" ? null : v })}
            options={[{ value: "todos", label: "Todos" }, ...profiles.map((p) => ({ value: p.slug, label: p.name, n: p.replicacoes }))]} />
        </div>
      )}
    </div>
  );

  return (
    <div className="pd">
      {!embedded ? (
        <PageHeader title={perfil ? <>Produção <em>· {perfil.name}</em></> : <>Produ<em>ção</em></>} meta={meta}
          actions={<Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setNova(true)}>Nova replicação</Button>}>
          {controles}
        </PageHeader>
      ) : (
        <div className="pd-embedded-head">{controles}<div className="pd-embedded-meta num">{meta}</div><Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setNova(true)}>Nova replicação</Button></div>
      )}
      {!cartoes && <div className="pd-skel" aria-busy="true" aria-label="Carregando produção">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} ratio="3/4" />)}</div>}
      {cartoes && !cartoes.length && (
        <Empty title={<>Nada em produção <em>ainda</em></>} action={<Button variant="primary" onClick={() => setNova(true)}>Nova replicação</Button>}>
          {perfil ? `Nenhuma referência atribuída a ${perfil.name} e nenhuma replicação.` : "Escolha uma referência da biblioteca e o expert. A análise divide a referência em trechos e takes."}
        </Empty>
      )}
      {cartoes && cartoes.length > 0 && visao === "quadro" && <Quadro cartoes={cartoes} profiles={profiles} unico={!!perfil} />}
      {cartoes && cartoes.length > 0 && visao === "lista" && <Lista cartoes={cartoes} profiles={profiles} />}
      {cartoes && visao === "calendario" && (postsQ.data
        ? <Calendario posts={postsQ.data.itens.filter((p) => !perfil || p.perfil.slug === perfil.slug)} perfil={perfil} profiles={profiles} onLista={() => setFiltro({ visao: "lista" })} onPlanejado={postsQ.reload} />
        : <div className="pd-skel" aria-busy="true" aria-label="Carregando calendário">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} ratio="3/4" />)}</div>)}
      {nova && <NovaReplicacao expertInicial={personagemInicial} onClose={() => setNova(false)} />}
    </div>
  );
}

// ---------- Quadro ----------

function Quadro({ cartoes, profiles, unico }: { cartoes: Cartao[]; profiles: Profile[]; unico: boolean }) {
  const [fechadas, setFechadas] = usePref<string[]>("irh-producao-raias-fechadas", []);
  const [acao, setAcao] = useState<null | { tipo: "postado" | "agendar"; c: Cartao }>(null);
  const [alvo, setAlvo] = useState<Coluna | null>(null);
  const raias = useMemo(() => {
    const slugs = [...new Set(cartoes.map((c) => c.perfil ?? SEM_PERFIL))];
    const ordem = (s: string) => { const i = profiles.findIndex((p) => p.slug === s); return i < 0 ? 999 : i; };
    return slugs.sort((a, b) => ordem(a) - ordem(b)).map((slug) => ({ slug, perfil: profiles.find((p) => p.slug === slug) ?? null, cartoes: cartoes.filter((c) => (c.perfil ?? SEM_PERFIL) === slug) }));
  }, [cartoes, profiles]);
  // A coluna vazia encolhe (SPEC §4.9): a mesma grade para o cabeçalho e todas as raias.
  const grade = COLUNAS.map((c) => cartoes.some((x) => x.coluna === c.id) ? "minmax(168px,1fr)" : "minmax(120px,.5fr)").join(" ");
  const drop = (col: Coluna) => (e: DragEvent) => {
    e.preventDefault(); setAlvo(null);
    const c = cartoes.find((x) => x.key === e.dataTransfer.getData("text/x-irh-cartao"));
    if (!c?.id) return;
    if (col === "postada" && c.coluna !== "postada") setAcao({ tipo: "postado", c });
    else if (col === "agendada" && c.coluna !== "postada") setAcao({ tipo: "agendar", c });
    else if (col !== c.coluna) toast("A etapa vem dos arquivos da replicação. Arraste só para Agendada ou Postada.");
  };
  const over = (col: Coluna) => (e: DragEvent) => { if (col === "postada" || col === "agendada") { e.preventDefault(); setAlvo(col); } };
  return (
    <div className="pd-board-wrap">
      <div className="pd-board" style={{ ["--pd-cols" as string]: grade }}>
        <div className="pd-cols-head" role="presentation">
          {COLUNAS.map((c) => <div key={c.id} className="pd-col-h"><StageBadge stage={c.id} label={c.nome} /><span className="num">{fmtInt(cartoes.filter((x) => x.coluna === c.id).length)}</span></div>)}
        </div>
        {raias.map((r) => {
          const fechada = !unico && fechadas.includes(r.slug);
          const nome = r.perfil?.name ?? "Sem expert · só análise";
          return (
            <section key={r.slug} className="pd-lane" aria-label={`Raia ${nome}`}>
              <header className="pd-lane-h">
                <button type="button" className="pd-lane-t" aria-expanded={!fechada} disabled={unico} onClick={() => setFechadas(fechada ? fechadas.filter((s) => s !== r.slug) : [...fechadas, r.slug])}>
                  {!unico && <ChevronDown size={16} aria-hidden className={cx("pd-chev", fechada && "is-closed")} />}
                  <span className="pd-lane-n">{nome}</span>
                  {r.perfil && <span className="pd-lane-tipo">{TIPO_LABEL[r.perfil.tipo]}</span>}
                </button>
                <span className="pd-lane-c num">
                  {r.perfil ? <>{fmtInt(r.perfil.ref_count)} referências atribuídas · {fmtInt(r.perfil.replicacoes)} replicações</> : <>{fmtInt(r.cartoes.length)} sem expert</>}
                </span>
                {r.perfil && !unico && <a className="pd-lane-link" href={producaoHref(r.perfil.slug)} onClick={go(producaoHref(r.perfil.slug))}>Só esta raia</a>}
              </header>
              {!fechada && (
                <div className="pd-lane-grid">
                  {COLUNAS.map((col) => {
                    const lista = r.cartoes.filter((c) => c.coluna === col.id);
                    const aceita = col.id === "postada" || col.id === "agendada";
                    return (
                      <div key={col.id} className={cx("pd-cell", alvo === col.id && "is-target")} aria-label={`${col.nome} · ${nome}: ${lista.length}`}
                        onDragOver={aceita ? over(col.id) : undefined} onDragLeave={aceita ? () => setAlvo(null) : undefined} onDrop={aceita ? drop(col.id) : undefined}>
                        <span className="pd-cell-label">{col.nome} <span className="num">{lista.length}</span></span>
                        {lista.map((c) => <CartaoProducao key={c.key} c={c} />)}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {acao?.tipo === "postado" && acao.c.id && <MarcarPostadoModal id={acao.c.id} titulo={`${acao.c.ref} · ${acao.c.titulo.slice(0, 60)}`} onClose={() => setAcao(null)} />}
      {acao?.tipo === "agendar" && acao.c.id && <AgendarModal id={acao.c.id} titulo={`${acao.c.ref} · ${acao.c.titulo.slice(0, 60)}`} agendadoPara={acao.c.agendado_para} onClose={() => setAcao(null)} />}
    </div>
  );
}

function CartaoProducao({ c }: { c: Cartao }) {
  const href = c.href ?? (c.id ? estudioHref(c.id) : null);
  const abrir = (e: React.MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); if (href) navigate(href); else openRef(c.ref); };
  const arrastavel = !!c.id && c.coluna !== "postada" && c.perfil !== SEM_PERFIL;
  return (
    <article className={cx("pd-card", c.late && "is-late")} draggable={arrastavel}
      onDragStart={arrastavel ? (e) => { e.dataTransfer.setData("text/x-irh-cartao", c.key); e.dataTransfer.effectAllowed = "move"; } : undefined}>
      <div className="pd-card-m">{c.capa ? <img src={c.capa} alt="" loading="lazy" draggable={false} /> : <span aria-hidden />}</div>
      <div className="pd-card-b">
        <a className="pd-card-a" href={href ?? `/ref/${c.ref}`} onClick={abrir}>
          <span className="pd-card-ref num">{c.carrossel ? <span className="pd-card-tipo">Carrossel</span> : c.ref}{c.personagem && <span> · {c.personagem}</span>}</span>
          <span className="pd-card-t">{c.titulo}</span>
        </a>
        {/* A coluna já diz o estágio: no cartão, o glifo + o detalhe (etapa e clipes, data, link). */}
        <StageBadge stage={c.stage} late={c.late} href={c.post_url ?? undefined}
          label={c.coluna === "postada" ? `Postada${c.postado_em ? ` · ${fmtDate(c.postado_em).slice(0, 5)}` : ""}${c.post_url ? " ↗" : ""}`
            : c.coluna === "agendada" && c.agendado_para ? `Agendada · ${fmtDateTime(c.agendado_para).slice(0, 5)} ${fmtDateTime(c.agendado_para).slice(11)}`
            : c.coluna === "producao" || c.carrossel ? c.sub || "Em produção" : undefined} />
        {c.preparacao && c.coluna === "producao" && <span className="pd-card-prep">{c.preparacao}</span>}
        {c.clipsTotal > 0 && c.coluna === "producao" && (
          <span className="pd-prog" role="progressbar" aria-label="Clipes baixados" aria-valuenow={c.clips} aria-valuemin={0} aria-valuemax={c.clipsTotal}>
            <i style={{ width: `${(100 * c.clips) / c.clipsTotal}%` }} />
          </span>
        )}
      </div>
    </article>
  );
}

// ---------- Lista ----------

type Ordem = { col: "ref" | "estagio" | "agendado"; dir: 1 | -1 };

function Lista({ cartoes, profiles }: { cartoes: Cartao[]; profiles: Profile[] }) {
  const [ordem, setOrdem] = useState<Ordem>({ col: "estagio", dir: -1 });
  const [acao, setAcao] = useState<null | { tipo: "postado" | "agendar"; c: Cartao }>(null);
  const linhas = useMemo(() => [...cartoes].sort((a, b) => {
    const v = ordem.col === "ref" ? a.ref.localeCompare(b.ref)
      : ordem.col === "agendado" ? (a.agendado_para ?? a.postado_em ?? "").localeCompare(b.agendado_para ?? b.postado_em ?? "")
      : ORDEM[a.coluna] - ORDEM[b.coluna] || a.ref.localeCompare(b.ref);
    return v * ordem.dir;
  }), [cartoes, ordem]);
  const th = (col: Ordem["col"], label: string, cls?: string) => (
    <th className={cls} aria-sort={ordem.col === col ? (ordem.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="pd-th-b" onClick={() => setOrdem({ col, dir: ordem.col === col ? (ordem.dir === 1 ? -1 : 1) : 1 })}>{label}</button>
    </th>
  );
  const nomePerfil = (s: string | null) => s === SEM_PERFIL ? "Sem expert" : profiles.find((p) => p.slug === s)?.name ?? s ?? "—";
  return (
    <div className="tbl-wrap">
      <table className="tbl pd-tbl">
        <caption className="sr">Produção em lista, {cartoes.length} itens</caption>
        <thead><tr>
          {th("ref", "REF")}
          <th className="hide-m">Título</th>
          <th className="hide-m">Expert</th>
          {th("estagio", "Estágio")}
          <th className="num hide-m">Clipes</th>
          {th("agendado", "Data", "data hide-m")}
          <th><span className="sr">Ações</span></th>
        </tr></thead>
        <tbody>
          {linhas.map((c) => {
            const href = c.href ?? (c.id ? estudioHref(c.id) : null);
            return (
              <tr key={c.key} className={cx(c.late && "is-late")}>
                <td className="nw"><a className="num pd-tbl-ref" href={href ?? `/ref/${c.ref}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); href ? navigate(href) : openRef(c.ref); }}>{c.ref}</a></td>
                <td className="hide-m pd-tbl-t"><span>{c.titulo}</span></td>
                <td className="hide-m nw">{nomePerfil(c.perfil)}{c.personagem && <span className="text-ink-3"> · {c.personagem}</span>}</td>
                <td className="nw"><StageBadge stage={c.stage} sub={c.coluna === "postada" ? undefined : c.sub || undefined} late={c.late} /></td>
                <td className="num hide-m">{c.clipsTotal ? `${c.clips}/${c.clipsTotal}` : "—"}</td>
                <td className="data hide-m">{c.postado_em ? fmtDateTime(c.postado_em) : c.agendado_para ? fmtDateTime(c.agendado_para) : "—"}</td>
                <td className="nw pd-tbl-acts">
                  {c.post_url ? <ButtonLink size="sm" variant="ghost" href={c.post_url} external icon={<ExternalLink size={14} />}>Post</ButtonLink>
                    : c.id && (c.coluna === "pronta" || c.coluna === "agendada") ? <>
                      <Button size="sm" variant="ghost" className="hide-m" icon={<CalendarClock size={14} />} onClick={() => setAcao({ tipo: "agendar", c })}>{c.agendado_para ? "Reagendar" : "Agendar"}</Button>
                      <Button size="sm" variant="primary" icon={<Send size={14} />} onClick={() => setAcao({ tipo: "postado", c })}>Postei</Button>
                      {c.id.includes("--") && <Button size="sm" variant="ghost" icon={<Archive size={14} />} onClick={() => void arquivar(c.id!)} title="Tirar da fila de postagem (nada é apagado)">Arquivar</Button>}
                    </> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {acao?.tipo === "postado" && acao.c.id && <MarcarPostadoModal id={acao.c.id} titulo={`${acao.c.ref} · ${acao.c.titulo.slice(0, 60)}`} onClose={() => setAcao(null)} />}
      {acao?.tipo === "agendar" && acao.c.id && <AgendarModal id={acao.c.id} titulo={`${acao.c.ref} · ${acao.c.titulo.slice(0, 60)}`} agendadoPara={acao.c.agendado_para} onClose={() => setAcao(null)} />}
    </div>
  );
}

// ---------- Calendário (semana) ----------

const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const inicioSemana = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const mesmoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Calendário da semana: um item por POST (cada variação, carrossel e vídeo próprio), a mesma lista da Home e do painel. */
function Calendario({ posts, perfil, profiles, onLista, onPlanejado }: { posts: PostItem[]; perfil?: Profile; profiles: Profile[]; onLista: () => void; onPlanejado: () => void }) {
  const [semana, setSemana] = useState(() => inicioSemana(new Date()));
  const agenda = useApi<{ meta: number; horarios: string[]; auto: boolean; perfis?: Record<string, {meta:number}> }>("/api/agenda").data;
  const [planejando, setPlanejando] = useState(false);
  const planejar = async () => {
    setPlanejando(true);
    const r = await act(() => api<{ criados: string[]; agendados: unknown[] }>("/api/agenda/planejar", { method: "POST" }));
    setPlanejando(false);
    if (!r) return;
    toast(r.agendados.length ? `${r.agendados.length} ${r.agendados.length === 1 ? "post agendado" : "posts agendados"}${r.criados.length ? ` · ${r.criados.length} novo${r.criados.length === 1 ? "" : "s"}` : ""}` : "Nada pronto sem data");
    onPlanejado();
  };
  // Meta por dia é de cada perfil: no "Todos", o dia mostra a conta de cada um.
  const perfisNoDia = (itens: { p: PostItem }[]) => [...new Set(itens.map((x) => x.p.perfil.slug))];
  const nomeCurto = (slug: string) => (profiles.find((p) => p.slug === slug)?.name ?? slug).split(" ").slice(0, 2).join(" ");
  const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(semana); d.setDate(d.getDate() + i); return d; });
  const hoje = new Date();
  const datado = posts.filter((p) => p.stage !== "arquivada" && (p.postado_em || p.agendado_para))
    .map((p) => ({ p, quando: new Date((p.stage === "postada" ? p.postado_em ?? p.agendado_para : p.agendado_para ?? p.postado_em)!) }));
  const semData = posts.filter((p) => p.stage === "pronta" && !p.agendado_para).length;
  const mover = (n: number) => { const d = new Date(semana); d.setDate(d.getDate() + 7 * n); setSemana(d); };
  const fim = dias[6];
  return (
    <div className="pd-cal">
      <div className="pd-cal-nav">
        <Button size="sm" variant="icon" aria-label="Semana anterior" onClick={() => mover(-1)}><ChevronLeft size={16} /></Button>
        <span className="num pd-cal-range">{fmtDate(semana.toISOString()).slice(0, 5)} – {fmtDate(fim.toISOString())}</span>
        <Button size="sm" variant="icon" aria-label="Próxima semana" onClick={() => mover(1)}><ChevronRight size={16} /></Button>
        <Button size="sm" variant="ghost" onClick={() => setSemana(inicioSemana(new Date()))}>Esta semana</Button>
        {semData > 0 && <p className="pd-cal-note">{semData} {semData === 1 ? "post pronto sem data" : "posts prontos sem data"} · <button type="button" className="pd-inline-link" onClick={onLista}>agendar na lista</button></p>}
        <span className="pd-cal-meta num">
          {agenda ? <>Meta {agenda.perfis?.[perfil?.slug ?? ""]?.meta ?? agenda.meta} por dia · {agenda.auto ? "agenda automática ligada" : "agenda automática desligada"}</> : null}
        </span>
        <Button size="sm" icon={<CalendarClock size={14} />} busy={planejando} busyLabel="Planejando…" onClick={planejar} title="Coloca todo post pronto sem data (ou vencido) no próximo horário livre, respeitando a meta por dia">Planejar agora</Button>
      </div>
      <ol className="pd-cal-grid">
        {dias.map((d, i) => {
          const itens = datado.filter((x) => mesmoDia(x.quando, d)).sort((a, b) => a.quando.getTime() - b.quando.getTime());
          return (
            <li key={i} className={cx("pd-day", mesmoDia(d, hoje) && "is-today")}>
              <h3 className="pd-day-h"><span>{DIAS[i]}</span> <span className="num">{fmtDate(d.toISOString()).slice(0, 5)}</span>{mesmoDia(d, hoje) && <span className="pd-hoje">hoje</span>}</h3>
              {agenda && (perfil
                ? <p className={cx("pd-day-meta num", itens.length >= (agenda.perfis?.[perfil?.slug ?? ""]?.meta ?? agenda.meta) ? "is-cheio" : "is-falta")}>{itens.length}/{agenda.perfis?.[perfil?.slug ?? ""]?.meta ?? agenda.meta}</p>
                : itens.length > 0 && <p className="pd-day-meta num">{perfisNoDia(itens).map((s) => `${nomeCurto(s)} ${itens.filter((x) => x.p.perfil.slug === s).length}/${agenda.perfis?.[s]?.meta ?? agenda.meta}`).join(" · ")}</p>)}
              {itens.length ? (
                <ul className="pd-day-l">
                  {itens.map(({ p, quando }) => {
                    const href = p.post_url ?? p.hub_url ?? (p.ref ? `/ref/${p.ref}` : null);
                    const capa = p.capa ?? (p.ref_thumb ? media(p.ref_thumb) : null);
                    return (
                      <li key={p.id}>
                        <a className="ig ig--grid" href={href ?? undefined} {...(p.post_url ? { target: "_blank", rel: "noreferrer" } : href ? { onClick: go(href) } : {})} aria-label={`${p.ref ?? "Post"} · ${p.titulo}`}>
                          {capa ? <img src={capa} alt="" loading="lazy" /> : <span className="ig-poster-ph" />}
                          <StageBadge stage={p.stage === "arquivada" ? "pronta" : p.stage} label={p.stage === "postada" ? "Postada" : p.late ? "Atrasada" : p.stage === "producao" ? "Produção" : "Agendada"} late={p.late} />
                        </a>
                        <p className="num pd-day-c">{p.ref ? p.ref : p.tipo === "carrossel" ? "Carrossel" : "Vídeo"}{p.versao && p.tipo === "video" ? ` ${p.versao}` : ""} · {String(quando.getHours()).padStart(2, "0")}:{String(quando.getMinutes()).padStart(2, "0")}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="pd-day-vazio">Nada</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// =====================================================================
// Exports antigos (o App.tsx atual): wrappers finos sobre a UI nova
// =====================================================================

/** /replicacao (lê ?expert= e ?visao=). */
export function Replicacoes() {
  return <Producao />;
}

/** /replicacao/:id (lê a aba de ?aba=). */
export function ReplicacaoPage({ refId: id }: { refId: string }) {
  const loc = useLocation();
  return <Estudio id={id} aba={estudioAba(new URLSearchParams(loc.search).get("aba"))} />;
}

// =====================================================================
// Estúdio (SPEC §5.2): abas em sub-rota, sidebar mantida, ações secundárias no ⋯
// =====================================================================

export function Estudio({ id, aba = "referencia" }: { id: string; aba?: EstudioAba | string }) {
  const path = `/api/replicacoes/${id}`;
  const { data, error, reload } = useApi<any>(path);
  const { info: naoEncontrado, checking } = useNaoEncontrado(path, error);
  const pending = !!data?.preparacao && !["erro", "pronto"].includes(data.preparacao.status);
  useEffect(() => { if (!pending) return; const timer = setInterval(() => { if (document.visibilityState !== "hidden") reload(); }, 4000); return () => clearInterval(timer); }, [pending, reload]);
  const [versao, setVersao] = useState<string | null>(null);
  const [criar, setCriar] = useState(false);
  const [editarCopy, setEditarCopy] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const abaAtual = estudioAba(aba);
  // A URL guarda a aba: recarregar reabre a mesma aba. O ID canônico (slug da pasta) substitui o alias.
  const trocarAba = (a: EstudioAba) => navigate(estudioHref(data?.id ?? id, a), { replace: true });
  useEffect(() => { if (data?.id && data.id !== id) navigate(estudioHref(data.id, abaAtual), { replace: true }); }, [data?.id, id]);

  if (naoEncontrado) return <ExpertNaoEncontradoState info={naoEncontrado} href={(s) => estudioHref(`${id.split("--")[0]}--${s}`, abaAtual)} todos={{ label: "Ver toda a produção", href: producaoHref(null) }} />;
  if (error && !data && !checking) return <ErrorState title="Replicação não encontrada" detail={error} onRetry={reload} />;
  if (!data) return <div className="pd-skel" aria-busy="true" aria-label="Carregando estúdio"><Skeleton ratio="9/16" /><Skeleton ratio="9/16" /><Skeleton ratio="9/16" /></div>;
  const seg = data.shots;
  const rep: ReplicacaoV2 | null = data.replicacao;
  const ref = data.ref;
  const preparar = async () => { setPreparando(true); await act(() => api(`/api/replicacoes/${ref}/segmentar`, { method: "POST", json: {} }), seg ? "Trechos atualizados" : "Preparação iniciada"); setPreparando(false); };

  if (!rep) {
    const emAndamento = !!data.preparacao && !["erro", "pronto"].includes(data.preparacao.status);
    return (
      <div>
        <PageHeader title={<>{ref} <em>· análise</em></>}
          meta={seg ? `${seg.shots.length} trechos de referência · ${seg.shots.reduce((n: number, s: any) => n + s.takes.length, 0)} takes · ${seg.setups ?? "?"} setups visuais · ${fmtS(seg.duracao)}` : emAndamento ? "Preparando trechos e frames da referência" : "Sem trechos preparados"}
          actions={<>{seg && <FramesFolderButton id={id} />}<Button onClick={() => openRef(ref)}>Ver referência</Button><Button icon={<RefreshCw size={14} />} busy={preparando} busyLabel="Preparando…" onClick={preparar}>{seg ? "Atualizar trechos" : "Preparar trechos"}</Button><Button variant="primary" onClick={() => setCriar(true)}>Replicar para um expert</Button></>} />
        {data.outras?.length > 0 && <p className="mb-4 text-[13px] text-ink-2">Replicações desta REF: {data.outras.map((o: any) => <a key={o.id} href={estudioHref(o.id)} onClick={go(estudioHref(o.id))} className="mr-2 underline underline-offset-2">{o.expert}</a>)}</p>}
        {data.preparacao && <div role="status" className="mb-4 rounded-r3 border border-line bg-card p-4 text-[13px]"><strong>{data.preparacao.expert ?? "Referência"}</strong><p>{preparationLabel(data.preparacao)}</p><p className="mt-1 text-ink-2">Pedido salvo. Você pode continuar selecionando outras referências; esta preparação não depende desta página aberta.</p></div>}
        <PainelAnalise data={data} refId={ref} />
        {seg ? <Segmentacao refId={ref} seg={seg} /> : emAndamento
          ? <Empty title="Preparando os trechos da referência">A preparação continua em segundo plano e esta página atualiza o andamento automaticamente.</Empty>
          : <Empty title={<>Sem trechos <em>preparados</em></>} action={<Button variant="primary" icon={<RefreshCw size={14} />} busy={preparando} busyLabel="Preparando…" onClick={preparar}>Preparar</Button>}>A referência ainda não foi dividida em trechos e takes.</Empty>}
        {criar && <NovaReplicacao refInicial={ref} onClose={() => setCriar(false)} />}
      </div>
    );
  }

  const v = rep.copy.versoes.some(x => x.id === versao) ? versao! : rep.copy.ativa;
  return <>
    <ReplicationStudio key={data.id ?? id} id={data.id ?? id} data={data} versao={v} onVersao={setVersao} onEditCopy={() => setEditarCopy(true)} aba={abaAtual} onAba={trocarAba}
      analysis={<PainelAnalise data={data} refId={ref} />}
      configuration={<StudioConfiguration id={data.id ?? id} rep={rep} />}
    />
    {editarCopy && <EditorCopy id={data.id ?? id} rep={rep} onClose={() => setEditarCopy(false)} />}
  </>;
}

function Segmentacao({ refId, seg }: { refId: string; seg: any }) {
  return (
    <ol className="space-y-4">
      {seg.shots.map((s: any) => (
        <li key={s.id} className="rounded-r3 border border-line bg-card p-3">
          <p className="mb-2 text-[14px]"><strong>{fragmentLabel(s.id)}</strong> <span className="num text-[12px] text-ink-2">{fmtS(s.ini)}–{fmtS(s.fim)} · {fmtS(s.duracao)} · {s.palavras} palavras{s.mudo ? " · mudo" : ""}{s.corte_forcado ? " · corte forçado" : ""}</span></p>
          <div className="flex gap-2 overflow-x-auto">
            {s.takes.map((t: any) => (
              <figure key={t.id} className="w-24 shrink-0">
                <img src={fileOf(refId, t.frame)} alt={t.id} loading="lazy" className="img-outline aspect-[9/16] w-full rounded-sm object-cover" />
                <figcaption className="num mt-1 text-[11px] text-ink-3">{t.id} · setup {t.setup} · imagem {t.still}</figcaption>
              </figure>
            ))}
          </div>
          {s.fala && <p className="mt-2 text-[13px] text-ink-2">“{s.fala}”</p>}
        </li>
      ))}
    </ol>
  );
}

function PainelAnalise({ data, refId }: { data: any; refId: string }) {
  const [busy, setBusy] = useState(false), [erro, setErro] = useState("");
  const a = data.analise, j = data.analise_job;
  const analisar = async () => { setBusy(true); await act(() => api(`/api/replicacoes/${refId}/analisar`, { method: "POST", json: {} }), "Análise iniciada; confira Watch e Gemini antes de importar o mapa"); setBusy(false); };
  return <section className="mb-6 rounded-r3 border border-line bg-card p-4 text-[13px]">
    <h2 className="mb-2 text-[15px] font-medium">Mapa de estados · Watch + Gemini</h2>
    <p className="mb-3 text-ink-2">{a ? `Revisão ${a.versao} · ${a.shots.length} trechos de referência · ${a.conferencia?.tipo === "automatica" ? "validada automaticamente" : "conferida"} em ${new Date(a.revisado_em).toLocaleString("pt-BR")}` : "Mapa ainda não conferido. As duas fontes precisam ser cruzadas antes de liberar os prompts."}</p>
    {j && <p className="mb-3 text-ink-2">Análise: {j.status === "analisando" ? "extraindo frames e analisando no Gemini…" : j.status === "aguardando_conferencia" ? "evidências prontas para conferência" : j.status}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button busy={busy || j?.status === "analisando"} busyLabel="Analisando…" onClick={analisar}>Analisar com Watch + Gemini</Button>
      <label className="btn btn--ghost">Importar mapa conferido (.json)<input aria-label="Importar mapa conferido" type="file" accept=".json,application/json" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { setErro(""); const json = JSON.parse(await f.text()); await act(() => api(`/api/replicacoes/${refId}/analise`, { method: "PUT", json }), "Mapa validado e takes atualizados"); } catch (x) { setErro(String(x)); } }} /></label>
      {a && <><ButtonLink variant="ghost" href={fileOf(refId, a.fontes.watch.arquivo)} external>Frames Watch</ButtonLink><ButtonLink variant="ghost" href={fileOf(refId, a.fontes.gemini.arquivo)} external>Análise Gemini</ButtonLink></>}
    </div>{erro && <p role="alert" className="mt-2 text-late">{erro}</p>}
    {a && <details className="mt-3"><summary className="cursor-pointer">Conferência por trecho de referência: objetos, mãos, antes/depois e câmera</summary><ol className="mt-3 space-y-3">{a.shots.map((s: any) => <li key={s.id}><strong>{fragmentLabel(s.id)}</strong> · {s.acao}<p className="text-ink-2">{anguloTexto(s.angulo)}</p><ul className="ml-4 list-disc">{s.estados.map((e: any, i: number) => <li key={i}>{fmtS(e.ini)}–{fmtS(e.fim)} · {e.props.join(", ") || "sem props"} · antes: {e.antes} → depois: {e.depois}. Mão direita: {e.maos.direita}; esquerda: {e.maos.esquerda}.</li>)}</ul>{s.incertezas.length > 0 && <p className="text-warn">Conferência: {s.incertezas.join("; ")}</p>}</li>)}</ol></details>}
  </section>;
}

function EditorCopy({ id, rep, onClose }: { id: string; rep: ReplicacaoV2; onClose: () => void }) {
  const [copyState, setCopyState] = useState(() => structuredClone(rep.copy)); const [v, setV] = useState(rep.copy.ativa);
  const [busy, setBusy] = useState(false);
  const atual = copyState.versoes.find(x => x.id === v)!;
  const salvar = async () => { setBusy(true); const r = await act(() => api(`/api/replicacoes/${id}/config`, { method: "PATCH", json: { copy: copyState } }), "Copy salva; confira os avisos de duração e objetos"); setBusy(false); if (r) onClose(); };
  return <Modal title="Versões de copy" onClose={onClose} width={760}
    footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" busy={busy} onClick={salvar}>Salvar versões</Button></>}>
    <p className="mb-3 text-[13px] text-ink-2">A fala entra literalmente no prompt, na entrega e na legenda. Evite acrescentar prova, credencial ou número sem fonte do expert.</p>
    <div className="mb-3 flex flex-wrap gap-2"><select aria-label="Versão para editar" className="field" value={v} onChange={e => setV(e.target.value)}>{copyState.versoes.map(x => <option key={x.id}>{x.id}</option>)}</select><Button onClick={() => { const n = `V${Math.max(...copyState.versoes.map(x => Number(x.id.slice(1)))) + 1}`; setCopyState({ ...copyState, versoes: [...copyState.versoes, { id: n, nome: "Novo ângulo", falas: { ...atual.falas } }] }); setV(n); }}>Nova versão</Button><Button variant="ghost" onClick={() => setCopyState({ ...copyState, ativa: v })}>{copyState.ativa === v ? "Versão ativa" : "Usar como ativa"}</Button></div>
    <label className="mb-3 block text-[13px]">Nome / ângulo de copy<input className="field block w-full" value={atual.nome} onChange={e => setCopyState({ ...copyState, versoes: copyState.versoes.map(x => x.id === v ? { ...x, nome: e.target.value } : x) })} /></label>
    <div className="max-h-[55vh] space-y-3 overflow-auto">{rep.shots.map(s => <label key={s.id} className="block text-[13px]">{fragmentLabel(s.id)}<textarea className="field block min-h-20 w-full" value={atual.falas[s.id] ?? s.fala} onChange={e => setCopyState({ ...copyState, versoes: copyState.versoes.map(x => x.id === v ? { ...x, falas: { ...x.falas, [s.id]: e.target.value } } : x) })} /></label>)}</div>
  </Modal>;
}

function StudioConfiguration({ id, rep }: { id: string; rep: ReplicacaoV2 }) {
  const [format, setFormat] = useState(rep.formato), [engine, setEngine] = useState(rep.engine), [busy, setBusy] = useState(false);
  const changed = format !== rep.formato || engine !== rep.engine;
  return <form className="rs-config-fields" onSubmit={async e => { e.preventDefault(); if (!changed) return; setBusy(true); await act(() => api(`/api/replicacoes/${id}/config`, { method: "PATCH", json: { formato: format, engine } }), "Configuração salva"); setBusy(false); }}>
    <label>Formato<select aria-label="Formato da replicação" className="field" value={format} onChange={e => setFormat(e.target.value as typeof format)}>{FORMAT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select></label>
    <label>Modelo de vídeo<select aria-label="Engine da replicação" className="field" value={engine} onChange={e => setEngine(e.target.value)}>{[...new Set([rep.engine, "Veo 3", "Seedance 2.0"])].map(e => <option key={e}>{e}</option>)}</select></label>
    <Button type="submit" variant="primary" busy={busy} disabledReason={!changed ? "Nada mudou" : undefined}>Salvar configuração</Button>
  </form>;
}

/** Atalho de leitura para outros pacotes: rótulo curto do perfil + link do expert. */
export function PerfilLink({ perfil, children }: { perfil: Profile; children?: ReactNode }) {
  const href = expertHref(perfil);
  return <a href={href} onClick={go(href)} className="underline underline-offset-2">{children ?? perfil.name}</a>;
}
