import { AlertTriangle, Archive, ArrowRight, Copy, Inbox, Link2, UserX } from "lucide-react";
import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import type { PipelineItem, PipelineResponse, Profile, RefCard, Stage } from "../../../server/types";
import type { PostItem } from "../../../server/posts";
import { postCard } from "../posts-card";
import { InstagramPost, type PostData } from "../components/InstagramPost";
import { LifecycleBar } from "../components/LifecycleBar";
import { StageBadge } from "../components/StageBadge";
import { ago, apiUrl, arquivarPost, fmtDateTime, fmtInt, media, navigate, openRef, plural, useApi, usePref, type StatsResponse } from "../lib";
import { findProfile, producaoHref } from "../replication-experts";
import { refShort, RefGrid } from "../refs";
import { Button, ButtonLink, cx, Empty, ErrorState, IconButton, Segmented, Skeleton } from "../ui";
import { useTriagemFila } from "./Triagem";

/**
 * Hoje (SPEC §5.2): substitui o Dashboard. Quatro blocos que pedem ação — Triagem, Produção por perfil,
 * Postar esta semana e Alertas —, depois "Chegou recentemente" e "CTAs mais usados" (top 8).
 * Nada de lista de 191 CTAs: o detalhe de cada referência mora na Biblioteca.
 */

type Stats = StatsResponse & {
  total: number;
  last_import: string | null;
  recent: RefCard[];
  cta_map: { id: string; username: string | null; actions: { kind: string; label: string; detail?: string }[] }[];
  pendencias?: { sem_formato: number; sem_objetivo: number; sem_criador: number; duplicados: number };
};
type ImportJob = { id: number; created_at: string; items: { id: number; url: string; status: string; error: string | null; ref_id: string | null }[] };
type Replicacao = { id: string; ref: string; expert: string | null; slug: string | null };
type Client = { id: number; name: string; profile_id?: number | null };
type Dup = { reason: string; ids: string[] };

const go = (to: string) => (e: MouseEvent) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); };
const bib = (q: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
  const s = sp.toString();
  return `/biblioteca${s ? `?${s}` : ""}`;
};
const fJson = (f: object) => JSON.stringify(f);

function dataHoje() {
  return new Date().toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(/\./g, "");
}

export function Hoje() {
  const stats = useApi<Stats>(apiUrl.stats());
  const s = stats.data;
  const fila = useTriagemFila();

  if (stats.error && !s) {
    return (
      <div>
        <Cabecalho />
        <ErrorState title="Não deu para ler a biblioteca" detail={stats.error} onRetry={stats.reload} />
      </div>
    );
  }

  if (s && s.total === 0) {
    return (
      <div>
        <Cabecalho />
        <Empty title={<>Comece pela <em>importação</em></>} action={<Button variant="accent" kbd="⌘I" onClick={() => window.dispatchEvent(new Event("irh:importar"))}>Importar</Button>}>
          Cole links de Reels ou posts. O Hub baixa vídeo, capa, legenda e métricas públicas e guarda tudo na pasta da biblioteca.
        </Empty>
      </div>
    );
  }

  return (
    <div>
      <Cabecalho meta={s ? (
        <>
          {plural(s.total, "referência", "referências")}
          {fila.total != null && <> · {fmtInt(fila.total)} esperando triagem</>}
          {s.last_import && <> · última importação {ago(s.last_import)}</>}
        </>
      ) : "Lendo a biblioteca…"} />

      <div className="grid gap-4 lg:grid-cols-2">
        <BlocoTriagem fila={fila} pend={s?.pendencias} />
        <BlocoProducao />
        <BlocoPostar />
        <BlocoAlertas />
      </div>

      <section className="mt-12">
        <SecTitle title={<>Chegou <em>recentemente</em></>} action={<LinkSeta to={bib({ f: fJson({ sort: "recentes" }) })}>Ver na Biblioteca</LinkSeta>} />
        {s ? <RefGrid items={s.recent.slice(0, 12)} density="compacta" /> : <GradeEsq />}
      </section>

      <section className="mt-12">
        <SecTitle title={<>CTAs mais <em>usados</em></>} meta="o que está escrito na legenda" />
        {s ? <TopCtas map={s.cta_map} /> : <Skeleton ratio="6/1" />}
      </section>
    </div>
  );
}

function Cabecalho({ meta }: { meta?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="title-serif text-[26px] sm:text-[34px]">Hoje, <em>{dataHoje()}</em></h1>
        {meta && <p className="num mt-1.5 text-[12px] text-ink-3">{meta}</p>}
      </div>
      <Button variant="accent" onClick={() => navigate("/postar")}>Abrir fila de postagem <ArrowRight size={15}/></Button>
    </header>
  );
}

/** Título de seção padrão do Hub (`.sec-h`, serif 20 na densidade compacta). */
export function SecTitle({ title, meta, action }: { title: ReactNode; meta?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-x-3">
      <div className="sec-h mb-0 min-w-0 flex-1 [&_h2]:text-[20px]">
        <h2>{title}</h2>
        {meta && <span className="mono text-[12px]">{meta}</span>}
      </div>
      {action && <span className="-my-1 shrink-0">{action}</span>}
    </div>
  );
}

function Bloco({ title, meta, action, children, className }: { title: ReactNode; meta?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col rounded-r3 border border-line bg-card p-4 sm:p-5", className)}>
      <SecTitle title={title} meta={meta} action={action} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function LinkSeta({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a href={to} onClick={go(to)} className="btn btn--ghost btn--sm">
      <span>{children}</span><ArrowRight size={14} strokeWidth={1.5} aria-hidden />
    </a>
  );
}

function GradeEsq({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} ratio="9/16" />)}
    </div>
  );
}

// ---------- 1. Triagem ----------

function BlocoTriagem({ fila, pend }: { fila: ReturnType<typeof useTriagemFila>; pend?: Stats["pendencias"] }) {
  const capas = (fila.items ?? []).slice(0, 6);
  return (
    <Bloco title="Triagem" meta="formato + objetivo" action={<LinkSeta to={bib({ aba: "triagem" })}>Abrir fila</LinkSeta>}>
      {fila.error && !fila.items ? <ErrorState title="Fila indisponível" detail={fila.error} onRetry={fila.reload} /> : (
        <>
          <p className="flex items-baseline gap-2">
            <span className="num font-serif text-[36px] leading-none">{fila.total == null ? "…" : fmtInt(fila.total)}</span>
            <span className="text-[13px] text-ink-2">{fila.total === 1 ? "referência esperando triagem" : "referências esperando triagem"}</span>
          </p>
          {fila.items == null ? <div className="mt-4"><GradeEsq /></div> : capas.length > 0 ? (
            <ul className="mt-4 grid grid-cols-6 gap-1.5" aria-label="Próximas da fila">
              {capas.map((r) => (
                <li key={r.id} className="min-w-0">
                  <a href={`/ref/${r.id}`} onClick={(e) => { e.preventDefault(); openRef(r.id); }}
                    className="block overflow-hidden rounded-r1 bg-media-bg outline-offset-2" style={{ aspectRatio: "9/16" }}
                    aria-label={`Abrir ${refShort(r.id)}${r.username ? ` de @${r.username}` : ""}`} title={refShort(r.id)}>
                    {r.thumb_path && <img src={media(r.thumb_path)} alt="" loading="lazy" className="size-full object-cover" />}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[13px] text-ink-2">Fila zerada. Toda referência guardada já tem formato e objetivo.</p>
          )}
          {pend && (
            <p className="num mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
              <a href={bib({ f: fJson({ sem_criador: true }) })} onClick={go(bib({ f: fJson({ sem_criador: true }) }))} className="underline-offset-4 hover:text-ink hover:underline">sem criador {fmtInt(pend.sem_criador)}</a>
              <span>sem formato {fmtInt(pend.sem_formato)}</span>
              <span>sem objetivo {fmtInt(pend.sem_objetivo)}</span>
            </p>
          )}
          <div className="mt-auto pt-4">
            <Button variant="primary" kbd="T" disabledReason={fila.total === 0 ? "Fila zerada" : undefined} onClick={() => navigate(bib({ aba: "triagem" }))}>Triar agora</Button>
          </div>
        </>
      )}
    </Bloco>
  );
}

// ---------- 2. Produção por perfil (números de /api/pipeline) ----------

const ORDEM_PROD: Stage[] = ["producao", "pronta", "agendada", "postada"];

function contar(itens: PipelineItem[]) {
  const c: Partial<Record<Stage, number>> = {};
  let late = 0;
  for (const it of itens) { c[it.stage] = (c[it.stage] ?? 0) + 1; if (it.late) late++; }
  return { c, late };
}

function BlocoProducao() {
  const pipe = useApi<PipelineResponse>(apiUrl.pipeline());
  const profiles = useApi<Profile[]>(apiUrl.profiles()).data;
  const linhas = useMemo(() => {
    const itens = pipe.data?.itens ?? [];
    const por = new Map<string, PipelineItem[]>();
    for (const it of itens) {
      const k = it.profile_slug ?? findProfile(profiles, it.client_slug)?.slug ?? `__${it.client_slug}`;
      por.set(k, [...(por.get(k) ?? []), it]);
    }
    const ordem = [...(profiles ?? []).map((p) => p.slug), ...[...por.keys()].filter((k) => !profiles?.some((p) => p.slug === k))];
    return ordem.filter((k) => por.has(k)).map((k) => {
      const p = profiles?.find((x) => x.slug === k);
      const lista = por.get(k)!;
      return { slug: p?.slug ?? null, nome: p?.name ?? lista[0].client_name ?? k.replace(/^__/, ""), ...contar(lista), total: lista.length };
    });
  }, [pipe.data, profiles]);

  return (
    <Bloco title="Produção por perfil" meta={pipe.data ? `Hub lido ${fmtDateTime(pipe.data.lido_em).slice(-5)}` : undefined}
      action={<LinkSeta to={producaoHref(null, null, true)}>Quadro</LinkSeta>}>
      {pipe.error && !pipe.data ? <ErrorState title="Produção indisponível" detail={pipe.error} onRetry={pipe.reload} /> :
        !pipe.data ? <div className="flex flex-col gap-3"><Skeleton ratio="8/1" /><Skeleton ratio="8/1" /></div> :
        !linhas.length ? <p className="text-[13px] text-ink-2">Nenhuma replicação em andamento. Replique uma referência da Biblioteca para ela aparecer aqui.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {linhas.map((l) => {
              const to = producaoHref(l.slug, null, true);
              return (
                <li key={l.nome} className="py-3 first:pt-0 last:pb-0">
                  <a href={to} onClick={go(to)} className="group block rounded-r2 outline-offset-4">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-medium group-hover:underline group-hover:underline-offset-4">{l.nome}</span>
                      <span className="num shrink-0 text-[11px] text-ink-3">{plural(l.total, "replicação", "replicações")}</span>
                    </span>
                    <LifecycleBar counts={l.c} order={ORDEM_PROD} legend={false} className="mt-2" />
                    <span className="num mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
                      <span>{fmtInt(l.c.producao ?? 0)} produção</span>
                      <span>{fmtInt(l.c.pronta ?? 0)} {(l.c.pronta ?? 0) === 1 ? "pronta" : "prontas"}</span>
                      <span>{fmtInt(l.c.agendada ?? 0)} {(l.c.agendada ?? 0) === 1 ? "agendada" : "agendadas"}</span>
                      <span>{fmtInt(l.c.postada ?? 0)} {(l.c.postada ?? 0) === 1 ? "postada" : "postadas"}</span>
                      {l.late > 0 && <StageBadge stage="atrasada" label={`${l.late} ${l.late === 1 ? "atrasada" : "atrasadas"}`} />}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
    </Bloco>
  );
}

// ---------- 3. Postar esta semana ----------

function semana(base = new Date()) {
  const ini = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  ini.setDate(ini.getDate() - ((ini.getDay() + 6) % 7)); // segunda
  const fim = new Date(ini); fim.setDate(ini.getDate() + 7);
  return { ini, fim };
}

/**
 * Fileira horizontal: o trackpad rola de lado nativamente; a roda do mouse (vertical) vira rolagem lateral
 * enquanto a fileira tem para onde ir, e nas pontas devolve a rolagem à página.
 */
function useTrilho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (max <= 1 || (d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });
  return ref;
}

type Janela = "hoje" | "semana";

function BlocoPostar() {
  const resp = useApi<{ itens: PostItem[] }>("/api/posts");
  const [janela, setJanela] = usePref<Janela>("irh.hoje.postar", "semana");
  const trilho = useTrilho<HTMLUListElement>();
  const { lista, semData, postadas, n } = useMemo(() => {
    const itens = resp.data?.itens ?? [];
    const { ini, fim } = semana();
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    const amanha = new Date(hoje0); amanha.setDate(hoje0.getDate() + 1);
    const naSemana = (iso: string | null) => !!iso && new Date(iso) >= ini && new Date(iso) < fim;
    const noDia = (iso: string | null) => !!iso && new Date(iso) >= hoje0 && new Date(iso) < amanha;
    const dentro = janela === "hoje" ? noDia : naSemana;
    // Um card por post (cada variação é um post): atrasados primeiro, depois pela hora.
    const fila = (f: typeof dentro) => itens
      .filter((p) => p.stage !== "postada" && p.stage !== "arquivada" && (p.late || f(p.agendado_para)))
      .sort((a, b) => Number(b.late) - Number(a.late) || String(a.agendado_para).localeCompare(String(b.agendado_para)));
    return {
      lista: fila(dentro),
      n: { hoje: fila(noDia).length, semana: fila(naSemana).length },
      semData: itens.filter((p) => p.stage === "pronta" && !p.agendado_para).length,
      postadas: itens.filter((p) => p.stage === "postada" && dentro(p.postado_em ?? p.agendado_para)).length,
    };
  }, [resp.data, janela]);
  const agendar = producaoHref(null, "lista", true);
  const cal = producaoHref(null, "calendario", true);
  const atrasados = lista.filter((i) => i.late).length;

  return (
    <Bloco title={janela === "hoje" ? "Postar hoje" : "Postar esta semana"}
      meta={resp.data ? [plural(lista.length - atrasados, "agendado", "agendados"), atrasados > 0 && plural(atrasados, "atrasado", "atrasados"), `${fmtInt(postadas)} já no ar`].filter(Boolean).join(" · ") : undefined}
      action={<span className="flex items-center gap-2">
        <Segmented size="sm" label="Período" value={janela} onChange={setJanela}
          options={[{ value: "hoje", label: "Hoje", n: resp.data ? n.hoje : null }, { value: "semana", label: "Semana", n: resp.data ? n.semana : null }]} />
        <LinkSeta to={cal}>Calendário</LinkSeta>
      </span>}>
      {resp.error && !resp.data ? <ErrorState title="Agenda indisponível" detail={resp.error} onRetry={resp.reload} /> :
        !resp.data ? <GradeEsq n={3} /> : lista.length ? (
          <ul ref={trilho} className="trilho -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
            {lista.map((p) => (
              <li key={p.id} className="flex w-[200px] shrink-0 snap-start">
                <InstagramPost compact className="flex-1" post={postCard(p)}
                  actions={<>
                    {p.hub_url && <ButtonLink size="sm" href={p.hub_url} onClick={go(p.hub_url)}>{p.tipo === "carrossel" ? "Abrir" : "Estúdio"}</ButtonLink>}
                    <IconButton size="sm" label="Arquivar este post (sai da fila, nada é apagado)" onClick={() => void arquivarPost(p.id)}><Archive size={15} strokeWidth={1.5} /></IconButton>
                  </>} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col">
            <p className="text-[13px] text-ink-2">{janela === "hoje" ? "Nada agendado para hoje." : "Nada agendado para esta semana."}</p>
            {semData > 0 && (
              <p className="mt-3 flex items-center gap-2 text-[13px]">
                <StageBadge stage="pronta" label={`${fmtInt(semData)} ${semData === 1 ? "pronto" : "prontos"} sem data`} />
              </p>
            )}
            <div className="mt-auto pt-4">
              <ButtonLink variant="secondary" href={agendar} onClick={go(agendar)}>Agendar na lista</ButtonLink>
            </div>
          </div>
        )}
    </Bloco>
  );
}

// ---------- 4. Alertas ----------

type Alerta = { key: string; icon: ReactNode; tone: "late" | "warn" | "ink"; title: ReactNode; detail?: ReactNode; action?: ReactNode };

function BlocoAlertas() {
  const jobsQ = useApi<ImportJob[]>("/api/import/jobs"), jobs = jobsQ.data;
  const dupsQ = useApi<Dup[]>("/api/duplicates"), dups = dupsQ.data;
  const repsQ = useApi<Replicacao[]>("/api/replicacoes"), reps = repsQ.data;
  const clients = useApi<Client[]>("/api/clients").data;
  const profilesQ = useApi<Profile[]>(apiUrl.profiles()), profiles = profilesQ.data;
  const pipe = useApi<PipelineResponse>(apiUrl.pipeline()).data;
  // Fonte que falhou não trava o bloco: os outros alertas aparecem.
  const loading = [jobsQ, dupsQ, repsQ, profilesQ].some((q) => !q.data && !q.error);

  const alertas = useMemo<Alerta[]>(() => {
    const out: Alerta[] = [];
    const atrasadas = (pipe?.itens ?? []).filter((it) => it.late);
    if (atrasadas.length) {
      const to = producaoHref(null, "lista", true);
      out.push({ key: "late", icon: <AlertTriangle aria-hidden />, tone: "late", title: `${plural(atrasadas.length, "post atrasado", "posts atrasados")}`,
        detail: atrasadas.slice(0, 3).map((a) => `${refShort(a.ref)} · ${a.client_name ?? a.client_slug}`).join(" · "),
        action: <ButtonLink size="sm" href={to} onClick={go(to)}>Ver na lista</ButtonLink> });
    }
    const erros = (jobs ?? []).slice(0, 20).flatMap((j) => j.items.filter((i) => i.status === "erro"));
    if (erros.length) {
      out.push({ key: "imp", icon: <Link2 aria-hidden />, tone: "late", title: `${plural(erros.length, "link com erro", "links com erro")} na importação`,
        detail: erros.slice(0, 2).map((e) => `${e.url.replace(/^https?:\/\/(www\.)?/, "")}: ${e.error ?? "erro"}`).join(" · "),
        action: <ButtonLink size="sm" href="/importar" onClick={go("/importar")}>Ver histórico</ButtonLink> });
    }
    const semAlias = [...new Set((reps ?? []).map((r) => r.slug).filter((s): s is string => !!s && !findProfile(profiles, s)))];
    const semPerfil = (clients ?? []).filter((c) => c.profile_id == null);
    if (semAlias.length || semPerfil.length) {
      out.push({ key: "slug", icon: <UserX aria-hidden />, tone: "warn",
        title: `${plural(semAlias.length + semPerfil.length, "expert sem perfil", "experts sem perfil")} no Hub`,
        detail: [...semAlias, ...semPerfil.map((c) => c.name)].join(" · "),
        action: <ButtonLink size="sm" href="/experts" onClick={go("/experts")}>Experts</ButtonLink> });
    }
    if (dups?.length) {
      out.push({ key: "dup", icon: <Copy aria-hidden />, tone: "ink", title: `${plural(dups.length, "par possivelmente duplicado", "pares possivelmente duplicados")}`,
        detail: (
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {dups.slice(0, 5).map((d) => (
              <a key={d.ids.join()} href={`/ref/${d.ids[0]}`} onClick={(e) => { e.preventDefault(); openRef(d.ids[0]); }} title={d.reason}
                className="underline-offset-4 hover:text-ink hover:underline">{d.ids.map(refShort).join(" × ")}</a>
            ))}
          </span>
        ) });
    }
    return out;
  }, [jobs, dups, reps, clients, profiles, pipe]);

  return (
    <Bloco title="Alertas" meta={loading ? undefined : alertas.length ? `${alertas.length} ${alertas.length === 1 ? "assunto" : "assuntos"}` : "nada pendente"}>
      {loading ? <div className="flex flex-col gap-3"><Skeleton ratio="8/1" /><Skeleton ratio="8/1" /></div> : !alertas.length ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-2"><Inbox size={16} strokeWidth={1.5} aria-hidden /> Nenhum erro de importação, duplicado ou expert sem perfil.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {alertas.map((a) => (
            <li key={a.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-r2 [&_svg]:size-4 [&_svg]:stroke-[1.75]",
                a.tone === "late" ? "bg-late-wash text-late" : a.tone === "warn" ? "bg-warn-wash text-warn" : "bg-sunken text-ink-2")}>{a.icon}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">{a.title}</p>
                {a.detail && <div className="num mt-0.5 text-[12px] break-words text-ink-3">{a.detail}</div>}
              </div>
              {a.action && <div className="shrink-0">{a.action}</div>}
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}

// ---------- CTAs mais usados ----------

function TopCtas({ map }: { map: Stats["cta_map"] }) {
  const top = useMemo(() => {
    const n = new Map<string, { label: string; detail?: string; n: number }>();
    for (const row of map ?? []) {
      for (const a of row.actions) {
        const k = `${a.kind}|${(a.detail ?? "").toUpperCase()}`;
        const cur = n.get(k) ?? { label: a.label, detail: a.detail ? a.detail.toUpperCase() : undefined, n: 0 };
        cur.n++; n.set(k, cur);
      }
    }
    return [...n.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  }, [map]);
  if (!top.length) return <p className="text-[13px] text-ink-2">Nenhuma CTA escrita nas legendas ainda.</p>;
  const max = top[0].n;
  return (
    <ol className="grid gap-x-8 sm:grid-cols-2">
      {top.map((c, i) => {
        const label = <>{c.label}{c.detail && <> <b className="font-medium">“{c.detail}”</b></>}</>;
        const to = c.detail ? bib({ f: fJson({ q: c.detail }) }) : null;
        return (
          <li key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(3rem,30%)_2.5rem] items-center gap-3 border-b border-line py-2.5">
            <span className="num text-[11px] text-ink-3">{String(i + 1).padStart(2, "0")}</span>
            {to ? <a href={to} onClick={go(to)} className="truncate text-[13px] underline-offset-4 hover:underline">{label}</a> : <span className="truncate text-[13px]">{label}</span>}
            <span className="h-1 overflow-hidden rounded-full bg-sunken" aria-hidden><span className="block h-full bg-ink-2" style={{ width: `${(c.n / max) * 100}%` }} /></span>
            <span className="num text-right text-[12px] text-ink-2">{fmtInt(c.n)}</span>
          </li>
        );
      })}
    </ol>
  );
}
