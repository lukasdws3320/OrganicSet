import { FORMAT_OPTIONS } from "../../../server/replication-formats";
import { ArrowDownUp, Download, LayoutGrid, List, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FacetsResponse, Filters, Funnel, Kind, Origem, RefCard, Sort, Stage } from "../../../server/types";
import { ORIGEM_LABEL, STAGE_LABEL } from "../../../server/types";
import { BatchBar, type BatchAction } from "../components/BatchBar";
import { FacetBar, type FacetDef } from "../components/FacetBar";
import { StageGlyph } from "../components/StageBadge";
import {
  act, api, apiUrl, fmtInt, isTyping, navigate, plural, readFilters, refsUrl, resultIds, toast, useApi, useBgLocation, usePref,
  type StatsResponse,
  invalidate,
} from "../lib";
import {
  clearSelection, GroupTitle, RefGrid, RefList, refShort, selection, toggleFavorite, toggleSelected, useSelection, useStageGroups, type Densidade,
} from "../refs";
import { Button, cx, Empty, ErrorState, Field, IconButton, Modal, Popover, Segmented, Skeleton } from "../ui";
import { QuadroCabecalho, QuadrosLista } from "./Collections";
import { Triagem, useTriagemFila } from "./Triagem";

// ---------- estado na URL ----------

export type Aba = "todas" | "triagem" | "favoritas" | "quadros" | "criadores";
const ABAS: Aba[] = ["todas", "triagem", "favoritas", "quadros", "criadores"];
export type Fluxo = "sem_destino" | "analise" | "producao" | "pronta" | "agendada" | "postada";

const SORTS: { value: Sort; label: string }[] = [
  { value: "recentes", label: "Mais recentes" },
  { value: "relevancia", label: "Relevância" },
  { value: "antigos", label: "Mais antigas" },
  { value: "publicacao", label: "Data de publicação" },
  { value: "views", label: "Mais visualizadas" },
  { value: "likes", label: "Mais curtidas" },
  { value: "comments", label: "Mais comentadas" },
  { value: "engajamento", label: "Maior engajamento" },
];

function readParams(search: string) {
  const sp = new URLSearchParams(search);
  const aba = sp.get("aba") as Aba | null;
  const quadro = Number(sp.get("quadro")) || undefined;
  const fluxo = sp.get("fluxo") as Fluxo | null;
  return { filters: readFilters(search), aba: aba && ABAS.includes(aba) ? aba : null, quadro, fluxo: fluxo && FLUXO_KEYS.includes(fluxo) ? fluxo : null };
}

/** Caminho da Biblioteca que funciona antes e depois do H4 (/biblioteca ou /referencias, que redireciona). */
function bibBase(path: string) {
  return path.startsWith("/biblioteca") ? "/biblioteca" : "/referencias";
}
export function bibHref(path: string, aba: Aba, extra: Record<string, string | number | undefined> = {}) {
  const sp = new URLSearchParams();
  if (aba !== "todas") sp.set("aba", aba);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return bibBase(path) + (s ? `?${s}` : "");
}

const cleanF = (f: Filters) => Object.fromEntries(Object.entries(f).filter(([, v]) =>
  v !== undefined && v !== "" && v !== false && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && v && !Object.keys(v).length)));

// ---------- faixa de fluxo (SPEC §5.2 item 4, números de /api/stats.funnel) ----------

const FLUXO_KEYS: Fluxo[] = ["sem_destino", "analise", "producao", "pronta", "agendada", "postada"];
const FLUXO_LABEL: Record<Fluxo, string> = { sem_destino: "Sem destino", analise: "Análise", producao: "Em produção", pronta: "Pronta", agendada: "Agendada", postada: "Postada" };
const FLUXO_GLIFO: Record<Fluxo, Stage> = { sem_destino: "guardada", analise: "producao", producao: "producao", pronta: "pronta", agendada: "agendada", postada: "postada" };

/** Mesma regra do funil do servidor, por referência: a célula conta replicações; o filtro mostra as referências que têm alguma. */
const FLUXO_TEST: Record<Fluxo, (r: RefCard) => boolean> = {
  sem_destino: (r) => !(r.pipeline?.length),
  analise: (r) => !!r.pipeline?.some((p) => p.etapa === "analise"),
  producao: (r) => !!r.pipeline?.some((p) => p.stage === "producao" && p.etapa !== "analise"),
  pronta: (r) => !!r.pipeline?.some((p) => p.stage === "pronta"),
  agendada: (r) => !!r.pipeline?.some((p) => p.stage === "agendada"),
  postada: (r) => !!r.pipeline?.some((p) => p.stage === "postada"),
};

function fluxoN(f: Funnel, k: Fluxo) {
  return k === "sem_destino" ? f.sem_destino + f.atribuida : f[k];
}

function FaixaFluxo({ funnel, value, onChange }: { funnel: Funnel | undefined; value: Fluxo | null; onChange: (v: Fluxo | null) => void }) {
  return (
    <div role="group" aria-label="Fluxo de produção" className="grid grid-cols-3 overflow-hidden rounded-r3 border border-line bg-card sm:grid-cols-6">
      {FLUXO_KEYS.map((k, i) => {
        const on = value === k;
        const n = funnel ? fluxoN(funnel, k) : null;
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            data-fluxo={k}
            onClick={() => onChange(on ? null : k)}
            title={k === "sem_destino" && funnel ? `${funnel.sem_destino} sem expert + ${funnel.atribuida} atribuídas sem replicação` : `Filtrar: ${FLUXO_LABEL[k]}`}
            className={cx(
              "group relative flex min-h-[64px] flex-col items-start justify-between gap-1 px-3 py-2.5 text-left transition-colors",
              "border-line", i % 3 !== 0 && "border-l", i >= 3 && "max-sm:border-t sm:border-l",
              on ? "bg-ink text-on-ink" : "hover:bg-sunken",
            )}
          >
            <span className={cx("st -my-1 h-[26px] text-[12px]", on && "!text-on-ink")} data-s={FLUXO_GLIFO[k]}>
              <StageGlyph s={FLUXO_GLIFO[k]} /><span className="st-t">{k === "producao" ? <><span className="max-sm:hidden">Em produção</span><span className="sm:hidden">Produção</span></> : FLUXO_LABEL[k]}</span>
            </span>
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="title-serif text-[26px] leading-none tabular-nums">{n == null ? "—" : fmtInt(n)}</span>
              {on && <X size={14} aria-hidden className="opacity-70" />}
            </span>
            {k === "sem_destino" && funnel && funnel.atribuida > 0 && (
              <span className={cx("num absolute top-2.5 right-3 text-[10px] max-sm:hidden", on ? "text-on-ink/70" : "text-ink-3")}>{funnel.atribuida} atrib.</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- abas ----------

function Abas({ aba, path, counts }: { aba: Aba; path: string; counts: Record<Aba, number | null> }) {
  const label: Record<Aba, string> = { todas: "Todas", triagem: "Triagem", favoritas: "Favoritas", quadros: "Quadros", criadores: "Criadores" };
  return (
    <nav aria-label="Abas da biblioteca" className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1 border-b border-line">
        {ABAS.map((a) => {
          const on = a === aba;
          return (
            <li key={a}>
              <a
                href={bibHref(path, a)}
                aria-current={on ? "page" : undefined}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); clearSelection(); navigate(bibHref(path, a)); }}
                className={cx(
                  "relative -mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13px] transition-colors [@media(pointer:coarse)]:h-11",
                  on ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
                )}
              >
                {label[a]}
                {counts[a] != null && <span className={cx("num text-[11px]", a === "triagem" && counts[a]! > 0 ? "text-brasa-ink" : "text-ink-3")}>{fmtInt(counts[a])}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---------- Biblioteca (export usado pelo H4) ----------

export type Scope = { favorite?: boolean; client?: number; collection?: number };

export function Biblioteca({ aba: abaProp = "todas", quadro: quadroProp }: { aba?: Aba; quadro?: number }) {
  const loc = useBgLocation();
  const p = readParams(loc.search);
  const aba = p.aba ?? abaProp;
  const quadro = p.quadro ?? quadroProp;
  const stats = useApi<StatsResponse & { total?: number; favorites_count?: number }>(apiUrl.stats()).data;
  const facets = useApi<FacetsResponse>(apiUrl.facets()).data;
  const cols = useApi<any[]>("/api/collections").data;
  const fila = useTriagemFila();
  const quadros = cols?.filter((c) => !String(c.name).startsWith("@")) ?? null;

  const counts: Record<Aba, number | null> = {
    todas: stats?.total ?? null,
    triagem: fila.total,
    favoritas: stats?.favorites_count ?? null,
    quadros: quadros?.length ?? null,
    criadores: facets?.criador.length ?? null,
  };

  // T: ir para a triagem (fora de campos e com o viewer fechado).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || isTyping(e) || location.pathname.startsWith("/ref/") || aba === "triagem") return;
      e.preventDefault();
      navigate(bibHref(loc.path, "triagem"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aba, loc.path]);

  const quadroAtual = quadro ? cols?.find((c) => c.id === quadro) : null;

  return (
    <div>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="title-serif text-[26px] sm:text-[34px]">{quadroAtual ? quadroAtual.name : <>Biblio<em>teca</em></>}</h1>
        <p className="num text-[12px] text-ink-3">
          {stats ? plural(Number(stats.total ?? 0), "referência", "referências") : "…"}
          {fila.total != null && <> · <span className={fila.total ? "text-brasa-ink" : undefined}>{fmtInt(fila.total)} esperando triagem</span></>}
        </p>
      </header>
      <Abas aba={aba} path={loc.path} counts={counts} />

      {aba === "triagem" && <Triagem />}
      {aba === "quadros" && !quadro && <QuadrosLista />}
      {aba === "quadros" && quadro && (
        <Grade key={`q${quadro}`} scope={{ collection: quadro }} header={<QuadroCabecalho id={quadro} />}
          emptyHint="Selecione referências na grade e use “Quadro” na barra de lote para adicioná-las aqui." />
      )}
      {aba === "criadores" && <Criadores facets={facets} />}
      {aba === "favoritas" && <Grade key="fav" scope={{ favorite: true }} emptyHint="Marque a estrela de uma referência (F) para ela aparecer aqui." />}
      {aba === "todas" && <Grade key="todas" scope={{}} faixa funnel={stats?.funnel} />}
    </div>
  );
}

// ---------- grade com filtros ----------

function Grade({ scope, header, emptyHint, faixa, funnel, title }: {
  scope: Scope; header?: ReactNode; emptyHint?: ReactNode; faixa?: boolean; funnel?: Funnel; title?: ReactNode;
}) {
  const loc = useBgLocation();
  const p = readParams(loc.search);
  const filters = p.filters;
  const fluxo = faixa ? p.fluxo : null;
  const setUrl = useCallback((f: Filters, fl: Fluxo | null = fluxo) => {
    const sp = new URLSearchParams(loc.search);
    const c = cleanF(f);
    if (Object.keys(c).length) sp.set("f", JSON.stringify(c)); else sp.delete("f");
    if (fl) sp.set("fluxo", fl); else sp.delete("fluxo");
    const s = sp.toString();
    navigate(loc.path + (s ? `?${s}` : ""), { replace: true });
  }, [loc.path, loc.search, fluxo]);
  const setFilters = (f: Filters) => setUrl(f);

  const query: Filters = { ...filters, sort: filters.sort ?? "recentes" };
  if (scope.favorite) query.favorite = true;
  if (scope.collection) query.collection = scope.collection;
  if (scope.client) query.clients = [...new Set([scope.client, ...(filters.clients ?? [])])];
  const { data, loading, error, reload } = useApi<{ items: RefCard[]; total: number }>(refsUrl(query));
  const items = useMemo(() => (data ? (fluxo ? data.items.filter(FLUXO_TEST[fluxo]) : data.items) : null), [data, fluxo]);
  const [dens, setDens] = usePref<Densidade>("irh-densidade", "grade");

  useEffect(() => { if (items) resultIds.set(items.map((r) => r.id)); }, [items]);
  // Seleção só do que está visível; trocar de filtro não deixa seleção fantasma.
  useEffect(() => { if (items) selection.set((s) => s.filter((id) => items.some((r) => r.id === id))); }, [items]);
  useEffect(() => () => { clearSelection(); resultIds.set([]); }, []);

  useGradeKeys(items);

  const activeN = Object.keys(cleanF(filters)).filter((k) => k !== "sort").length + (fluxo ? 1 : 0);
  const grouped = !!filters.profile && dens !== "lista";

  return (
    <div>
      {header}
      {title}
      {faixa && <div className="mb-4"><FaixaFluxo funnel={funnel} value={fluxo} onChange={(v) => setUrl(filters, v)} /></div>}
      <Filtros filters={filters} onChange={setFilters} scope={scope} dens={dens} setDens={setDens} query={query}
        onClearAll={() => setUrl(filters.sort ? { sort: filters.sort } : {}, null)} />

      <p className="num mt-3 text-[12px] text-ink-3" aria-live="polite">
        {items ? plural(items.length, "referência", "referências") : "Carregando…"}
        {activeN > 0 && ` · ${plural(activeN, "filtro", "filtros")}`}
        {fluxo && <> · fluxo <b className="font-medium text-ink">{FLUXO_LABEL[fluxo]}</b></>}
      </p>

      {error && !data && <div className="mt-6"><ErrorState title="Não deu para carregar as referências" detail={error} onRetry={reload} /></div>}
      {!data && !error && (
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} ratio="9/16" />)}
        </div>
      )}
      {items && items.length === 0 && (
        <div className="mt-6">
          {activeN > 0 ? (
            <Empty title={<>Nada com esses <em>filtros</em></>} action={<Button variant="secondary" onClick={() => setUrl({}, null)}>Limpar filtros</Button>}>
              Tire um filtro por vez para ver onde o resultado some.
            </Empty>
          ) : (
            <Empty title={<>Nada aqui <em>ainda</em></>} action={<Button variant="accent" onClick={() => navigate("/importar")}>+ Importar</Button>}>
              {emptyHint ?? "Cole links de Reels na importação. Os vídeos ficam no seu computador."}
            </Empty>
          )}
        </div>
      )}
      {items && items.length > 0 && (
        <div className={cx("mt-4 transition-opacity duration-200", loading && "opacity-60")}>
          {dens === "lista" ? <RefList items={items} /> : grouped ? <Agrupada items={items} dens={dens} /> : <RefGrid items={items} density={dens} />}
        </div>
      )}
      <Lote items={items ?? []} />
    </div>
  );
}

function Agrupada({ items, dens }: { items: RefCard[]; dens: Densidade }) {
  const groups = useStageGroups(items);
  return <>{groups.map((g) => <section key={g.stage}><GroupTitle n={g.items.length}>{g.label}</GroupTitle><RefGrid items={g.items} density={dens} /></section>)}</>;
}

/** J/K navegam entre os cards, X seleciona, F favorita, "/" busca (SPEC §5.2 Atalhos). */
function useGradeKeys(items: RefCard[] | null) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || location.pathname.startsWith("/ref/") || document.querySelector(".modal")) return;
      if (e.key === "/" && !isTyping(e)) { e.preventDefault(); document.querySelector<HTMLInputElement>("[data-busca]")?.focus(); return; }
      if (isTyping(e) || !items) return;
      const k = e.key.toLowerCase();
      if (k !== "j" && k !== "k" && k !== "x" && k !== "f") return;
      const cards = [...document.querySelectorAll<HTMLElement>(".refcard [data-card-open]")];
      const cur = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".refcard");
      const i = cur ? cards.findIndex((c) => cur.contains(c)) : -1;
      if (k === "j" || k === "k") {
        e.preventDefault();
        const next = cards[Math.max(0, Math.min(cards.length - 1, i + (k === "j" ? 1 : -1)))] ?? cards[0];
        next?.focus();
        next?.scrollIntoView({ block: "nearest" });
        return;
      }
      const id = cur?.dataset.ref ?? cur?.querySelector<HTMLElement>("[data-ref]")?.dataset.ref;
      const r = id ? items.find((x) => x.id === id) : null;
      if (!r) return;
      e.preventDefault();
      if (k === "x") toggleSelected(r.id);
      else toggleFavorite(r);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);
}

// ---------- barra de filtros ----------

const KIND_LABEL: Record<Kind, string> = { video: "Reel", carrossel: "Carrossel", imagem: "Foto" };

function Filtros({ filters, onChange, scope, dens, setDens, query, onClearAll }: {
  filters: Filters; onChange: (f: Filters) => void; scope: Scope; dens: Densidade; setDens: (d: Densidade) => void; query: Filters; onClearAll: () => void;
}) {
  const facets = useApi<FacetsResponse>(apiUrl.facets()).data;
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const setFacet = (key: string, v: number[]) => set({ facets: { ...(filters.facets ?? {}), [key]: v } });
  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => setQ(filters.q ?? ""), [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => { if ((filters.q ?? "") !== q) set({ q: q || undefined, sort: q && !filters.sort ? "relevancia" : filters.sort }); }, 220);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const kindN = (k: Kind) => facets?.kind.find((x) => x.value === k)?.n ?? 0;
  const kinds: Kind[] = ["video", "carrossel", ...(kindN("imagem") ? (["imagem"] as Kind[]) : [])];
  const axis = (key: string) => facets?.facets.find((f) => f.key === key);
  const opts = (key: string) => [...(axis(key)?.values ?? []).map((v) => ({ value: v.id, label: v.name, n: v.n })), { value: 0, label: "Sem nada marcado", n: undefined as number | undefined }];

  const defs: FacetDef<any>[] = [
    { key: "formato", label: "Formato", options: opts("formato"), value: filters.facets?.formato ?? [], onChange: (v: number[]) => setFacet("formato", v), n: axis("formato")?.values.length },
    { key: "estilo", label: "Estilo visual", options: opts("estilo"), value: filters.facets?.estilo ?? [], onChange: (v: number[]) => setFacet("estilo", v) },
    { key: "objetivo", label: "Objetivo", options: opts("objetivo"), value: filters.facets?.objetivo ?? [], onChange: (v: number[]) => setFacet("objetivo", v) },
    { key: "angulo", label: "Ângulo", options: opts("angulo"), value: filters.facets?.angulo ?? [], onChange: (v: number[]) => setFacet("angulo", v) },
    {
      key: "criador", label: "Criador", multiple: false,
      options: (facets?.criador ?? []).map((c) => ({ value: c.username, label: `@${c.username}`, n: c.n })),
      value: filters.creator ? [filters.creator] : [], onChange: (v: string[]) => set({ creator: v[0] }),
    },
    ...(scope.client ? [] : [{
      key: "expert", label: "Expert", multiple: false,
      options: (facets?.profiles ?? []).map((p) => ({ value: p.slug, label: p.name, n: p.n })),
      value: filters.profile ? [filters.profile] : [], onChange: (v: string[]) => set({ profile: v[0] }),
    }]),
    {
      key: "origem", label: "Origem",
      options: (facets?.origem ?? []).map((o) => ({ value: o.value, label: ORIGEM_LABEL[o.value] ?? o.value, n: o.n })),
      value: filters.origem ?? [], onChange: (v: Origem[]) => set({ origem: v }),
    },
    {
      key: "ciclo", label: "Ciclo",
      options: (facets?.stage ?? []).map((s) => ({ value: s.value, label: STAGE_LABEL[s.value], n: s.n })),
      value: filters.stage ?? [], onChange: (v: Stage[]) => set({ stage: v }),
    },
  ];

  const extraN = [filters.minViews, filters.minLikes, filters.minComments, filters.minEngagement, filters.publishedFrom, filters.publishedTo, filters.importedFrom, filters.importedTo, filters.cta]
    .filter((v) => v != null && v !== "").length;
  const sortLabel = SORTS.find((s) => s.value === (filters.sort ?? "recentes"))?.label ?? "Ordenar";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 basis-[260px] items-center">
          <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 text-ink-3" />
          <input
            data-busca=""
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQ(""); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Buscar legenda, @criador, REF, transcrição…"
            aria-label="Buscar na biblioteca"
            className="field !pl-9 !pr-10"
          />
          {q ? (
            <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className="absolute right-1.5 grid size-8 place-items-center rounded-r1 text-ink-3 hover:text-ink"><X size={15} /></button>
          ) : <kbd className="pointer-events-none absolute right-3 max-md:hidden">/</kbd>}
        </label>
        <Popover align="end" width={240} trigger={({ toggle, open }) => (
          <Button size="sm" variant="secondary" icon={<ArrowDownUp size={14} />} aria-expanded={open} onClick={toggle}>{sortLabel}</Button>
        )}>
          {(close) => (
            <ul className="pop-list" role="menu">
              {SORTS.map((s) => (
                <li key={s.value} role="none">
                  <button type="button" role="menuitemradio" aria-checked={(filters.sort ?? "recentes") === s.value} className="pop-opt" onClick={() => { set({ sort: s.value }); close(); }}>
                    <span className="lb">{s.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
        <Segmented<Densidade> label="Densidade" size="sm" value={dens} onChange={setDens} options={[
          { value: "grade", label: <span className="sr">Grade</span>, icon: <LayoutGrid size={14} aria-hidden /> },
          { value: "compacta", label: <span className="sr">Compacta</span>, icon: <Rows3 size={14} aria-hidden /> },
          { value: "lista", label: <span className="sr">Lista</span>, icon: <List size={14} aria-hidden /> },
        ]} />
        <Exportar filters={query} />
      </div>

      <FacetBar
        label="Facetas"
        segment={{
          label: "Tipo", value: (filters.kind?.length === 1 ? filters.kind[0] : "tudo") as Kind | "tudo",
          onChange: (v) => set({ kind: v === "tudo" ? undefined : [v as Kind] }),
          options: [{ value: "tudo" as const, label: "Tudo" }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k], n: kindN(k) }))],
        }}
        facets={defs}
        shortcuts={[
          ...(facets && facets.sem_criador > 0 ? [{ key: "sem_criador", label: "Sem criador", n: facets.sem_criador, active: !!filters.sem_criador, onToggle: () => set({ sem_criador: filters.sem_criador ? undefined : true }) }] : []),
        ]}
        end={<MaisFiltros filters={filters} set={set} n={extraN} ctas={facets?.ctas ?? []} />}
        onClear={onClearAll}
      />
    </div>
  );
}

function MaisFiltros({ filters, set, n, ctas }: { filters: Filters; set: (p: Partial<Filters>) => void; n: number; ctas: { keyword: string; n: number }[] }) {
  return (
    <Popover align="end" width={320} trigger={({ toggle, open }) => (
      <button type="button" className={cx("facet", n > 0 && "on")} aria-expanded={open} onClick={toggle}>
        <SlidersHorizontal size={14} aria-hidden /> Mais{n > 0 && <span className="n">{n}</span>}
      </button>
    )}>
      {() => (
        <div className="grid grid-cols-2 gap-3 p-2">
          <span className="eyebrow col-span-2">Métricas mínimas</span>
          {([["minViews", "Visualizações"], ["minLikes", "Curtidas"], ["minComments", "Comentários"], ["minEngagement", "Engajamento %"]] as const).map(([k, l]) => (
            <Field key={k} label={<span className="text-[12px]">{l}</span>}>
              <input type="number" min={0} inputMode="numeric" className="field num" value={filters[k] ?? ""} onChange={(e) => set({ [k]: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </Field>
          ))}
          <span className="eyebrow col-span-2 mt-1">Publicação</span>
          <Field label={<span className="text-[12px]">De</span>}><input type="date" className="field num" value={filters.publishedFrom ?? ""} onChange={(e) => set({ publishedFrom: e.target.value || undefined })} /></Field>
          <Field label={<span className="text-[12px]">Até</span>}><input type="date" className="field num" value={filters.publishedTo ?? ""} onChange={(e) => set({ publishedTo: e.target.value || undefined })} /></Field>
          <span className="eyebrow col-span-2 mt-1">Importação</span>
          <Field label={<span className="text-[12px]">De</span>}><input type="date" className="field num" value={filters.importedFrom ?? ""} onChange={(e) => set({ importedFrom: e.target.value || undefined })} /></Field>
          <Field label={<span className="text-[12px]">Até</span>}><input type="date" className="field num" value={filters.importedTo ?? ""} onChange={(e) => set({ importedTo: e.target.value || undefined })} /></Field>
          {ctas.length > 0 && (
            <>
              <span className="eyebrow col-span-2 mt-1">CTA pedida na legenda</span>
              <div className="col-span-2 flex flex-wrap gap-1.5">
                {ctas.slice(0, 14).map((c) => (
                  <button key={c.keyword} type="button" aria-pressed={filters.cta === c.keyword} onClick={() => set({ cta: filters.cta === c.keyword ? undefined : c.keyword })}
                    className={cx("chip chip--static num !cursor-pointer", filters.cta === c.keyword && "!bg-ink !text-on-ink")}>“{c.keyword}” <span className="opacity-60">{c.n}</span></button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

function Exportar({ filters }: { filters: Filters }) {
  const qs = `?f=${encodeURIComponent(JSON.stringify(filters))}`;
  return (
    <Popover align="end" width={240} trigger={({ toggle, open }) => <IconButton label="Exportar metadados" size="sm" aria-expanded={open} onClick={toggle}><Download size={16} strokeWidth={1.5} /></IconButton>}>
      {(close) => (
        <div className="flex flex-col">
          <p className="px-2 pt-1 pb-2 text-[12px] text-ink-3">Exporta o resultado atual, com filtros.</p>
          <a className="pop-opt" href={`/api/export.csv${qs}`} onClick={close}><span className="lb">Planilha CSV</span></a>
          <a className="pop-opt" href={`/api/export.xlsx${qs}`} onClick={close}><span className="lb">Planilha Excel (.xlsx)</span></a>
        </div>
      )}
    </Popover>
  );
}

// ---------- seleção em lote (SPEC §4.5) ----------

type Valor = { id: number; name: string; n: number };

function Lote({ items }: { items: RefCard[] }) {
  const sel = useSelection();
  const refs = items.filter((r) => sel.includes(r.id));
  const facetsAll = useApi<FacetsResponse>(sel.length ? apiUrl.facets(true) : null).data;
  const experts = useApi<{ id: number; name: string; ativo?: boolean }[]>(sel.length ? "/api/clients" : null).data?.filter(e => e.ativo !== false);
  const cols = useApi<any[]>(sel.length ? "/api/collections" : null).data;
  const [replicar, setReplicar] = useState(false);
  if (!refs.length) return null;

  const valores = (key: string): Valor[] => facetsAll?.facets.find((f) => f.key === key)?.values ?? [];
  const n = refs.length;
  const noun = n === 1 ? "referência" : "referências";

  const aplicarFaceta = (key: string, label: string, v: Valor) => {
    const antes = refs.map((r) => [r.id, (r.facets?.[key] ?? []).map((x) => x.id)] as const);
    return act(
      async () => { for (const r of refs) await api(apiUrl.ref(r.id), { method: "PATCH", json: { facets: { [key]: [v.id] } } }); },
      `${label} “${v.name}” em ${n} ${noun}`,
      async () => { for (const [id, prev] of antes) await api(apiUrl.ref(id), { method: "PATCH", json: { facets: { [key]: prev } } }); },
    );
  };
  const facetPop = (key: string, label: string) => (close: () => void) => {
    const list = valores(key);
    if (!facetsAll) return <p className="pop-empty">Carregando…</p>;
    return (
      <ul className="pop-list" role="menu" aria-label={label}>
        {list.map((v) => (
          <li key={v.id} role="none">
            <button type="button" role="menuitem" className="pop-opt" onClick={() => { close(); aplicarFaceta(key, label, v); }}>
              <span className="lb">{v.name}</span><span className="n">{v.n}</span>
            </button>
          </li>
        ))}
        <li role="none"><NovoValorLote label={label} onCreate={async (name) => {
          const c = await act(() => api<{ id: number; name: string }>(`/api/facets/${key}/values`, { json: { name } }));
          if (c) { close(); aplicarFaceta(key, label, { id: c.id, name: c.name ?? name, n: 0 } as Valor); }
        }} /></li>
      </ul>
    );
  };

  const actions: BatchAction[] = [
    { id: "formato", label: "Formato", mobile: true, popover: facetPop("formato", "Formato") },
    { id: "estilo", label: "Estilo visual", mobile: true, popover: facetPop("estilo", "Estilo visual") },
    { id: "objetivo", label: "Objetivo", mobile: true, popover: facetPop("objetivo", "Objetivo") },
    { id: "criador", label: "Criador", popover: (close) => <CriadorLote refs={refs} close={close} /> },
    {
      id: "expert", label: "Atribuir expert", popover: (close) => !experts ? <p className="pop-empty">Carregando…</p> : (
        <ul className="pop-list" role="menu">
          {experts.map((e) => (
            <li key={e.id} role="none">
              <button type="button" role="menuitem" className="pop-opt" onClick={() => {
                close();
                const antes = refs.map((r) => [r.id, r.clients.map((c) => c.id)] as const);
                act(async () => { for (const [id, prev] of antes) if (!prev.includes(e.id)) await api(apiUrl.ref(id), { method: "PATCH", json: { clients: [...prev, e.id] } }); },
                  `${n} ${noun} atribuída${n === 1 ? "" : "s"} a ${e.name}`,
                  async () => { for (const [id, prev] of antes) await api(apiUrl.ref(id), { method: "PATCH", json: { clients: prev } }); });
              }}><span className="lb">{e.name}</span></button>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "quadro", label: "Quadro", popover: (close) => <QuadroLote refs={refs} close={close} quadros={(cols ?? []).filter((c) => c.kind === "manual" && !String(c.name).startsWith("@"))} />,
    },
  ];
  const videos = refs.filter((r) => r.kind === "video");

  return (
    <>
      <BatchBar count={n} actions={actions} onClear={clearSelection}
        primary={{ label: "Replicar", onSelect: () => setReplicar(true), disabledReason: videos.length ? undefined : "Replicação só para reels com vídeo" }} />
      {replicar && <ReplicarLote refs={videos} experts={experts ?? []} onClose={() => setReplicar(false)} />}
    </>
  );
}

function CriadorLote({ refs, close }: { refs: RefCard[]; close: () => void }) {
  const [v, setV] = useState("");
  const alvo = refs.filter((r) => !r.username);
  if (!alvo.length) return <p className="pop-empty">Todas as selecionadas já têm @ do Instagram.</p>;
  const aplicar = () => {
    const g = v.trim().replace(/^@/, "");
    if (!g) return;
    close();
    const antes = alvo.map((r) => [r.id, r.creator_guess] as const);
    act(async () => { for (const r of alvo) await api(apiUrl.ref(r.id), { method: "PATCH", json: { creator_guess: g } }); },
      `@${g}? sugerido em ${alvo.length} sem @`,
      async () => { for (const [id, prev] of antes) await api(apiUrl.ref(id), { method: "PATCH", json: { creator_guess: prev } }); });
  };
  return (
    <form className="flex flex-col gap-2 p-1" onSubmit={(e) => { e.preventDefault(); aplicar(); }}>
      <Field label={<span className="text-[12px]">@ sugerido para {alvo.length} sem @</span>}>
        <input autoFocus className="field" value={v} onChange={(e) => setV(e.target.value)} placeholder="@criador" />
      </Field>
      <Button type="submit" size="sm" variant="primary" disabledReason={v.trim() ? undefined : "Digite o @"}>Aplicar sugestão</Button>
    </form>
  );
}

function QuadroLote({ refs, close, quadros }: { refs: RefCard[]; close: () => void; quadros: any[] }) {
  const [novo, setNovo] = useState("");
  const ids = refs.map((r) => r.id);
  const add = (c: { id: number; name: string }) => act(
    () => api(`/api/collections/${c.id}/refs`, { json: { refs: ids } }),
    `${ids.length} no quadro “${c.name}”`,
    () => api(`/api/collections/${c.id}/refs`, { json: { refs: ids, remove: true } }),
  );
  return (
    <div>
      <ul className="pop-list" role="menu">
        {quadros.map((c) => (
          <li key={c.id} role="none"><button type="button" role="menuitem" className="pop-opt" onClick={() => { close(); add(c); }}><span className="lb">{c.name}</span><span className="n">{c.ref_count}</span></button></li>
        ))}
      </ul>
      <form className="mt-1 flex gap-1 border-t border-line pt-2" onSubmit={async (e) => {
        e.preventDefault();
        const name = novo.trim();
        if (!name) return;
        const c = await act(() => api<{ id: number; name: string }>("/api/collections", { json: { name, kind: "manual" } }));
        if (c) { close(); add(c); }
      }}>
        <input className="field h-9 min-w-0 flex-1 text-[13px]" placeholder="Novo quadro" aria-label="Nome do novo quadro" value={novo} onChange={(e) => setNovo(e.target.value)} />
        <Button type="submit" size="sm" variant="secondary">Criar</Button>
      </form>
    </div>
  );
}

/** Replicar em lote: confirma em Modal listando as referências e o perfil (SPEC §4.5). */
function ReplicarLote({ refs, experts, onClose }: { refs: RefCard[]; experts: { id: number; name: string }[]; onClose: () => void }) {
  const [expert, setExpert] = useState<number | null>(null);
  const [formato, setFormato] = useState("");
  const [engine, setEngine] = useState("Veo 3");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!expert) return;
    setBusy(true);
    let ok = 0, existentes = 0;
    const falhas: string[] = [];
    for (const r of refs) {
      try {
        const res = await api<any>("/api/replicacoes", { json: { ref: r.id, expert_id: expert, formato, engine } });
        if (res.existente) existentes++; else ok++;
      } catch (e: any) { falhas.push(`${refShort(r.id)}: ${e.message}`); }
    }
    setBusy(false);
    invalidate();
    toast(`${ok} replicaç${ok === 1 ? "ão pedida" : "ões pedidas"}${existentes ? ` · ${existentes} já existia${existentes > 1 ? "m" : ""}` : ""}${falhas.length ? ` · ${falhas.length} com erro` : ""}`, falhas.length ? "erro" : "ok");
    if (falhas.length) toast(falhas.join(" · "), "erro");
    if (ok || existentes) { clearSelection(); onClose(); }
  };
  return (
    <Modal title={<>Replicar {refs.length} <em>{refs.length === 1 ? "referência" : "referências"}</em></>} onClose={onClose} width={560}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="accent" busy={busy} busyLabel="Pedindo…" onClick={go} disabledReason={expert ? undefined : "Escolha o expert"}>Replicar {refs.length}</Button>
      </>}>
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-[13px] font-medium">Para qual expert</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Expert">
            {experts.map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={expert === e.id} onClick={() => setExpert(e.id)}
                className={cx("flex min-h-11 items-center gap-2 rounded-r2 border px-3 text-left text-[13px]", expert === e.id ? "border-ink bg-ink text-on-ink" : "border-line-2 bg-card hover:border-ink-3")}>
                {e.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Formato da replicação</span>
          <select aria-label="Formato da replicação" className="field w-full" value={formato} onChange={e => setFormato(e.target.value)}><option value="">Usar formato da referência</option>{FORMAT_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Engine</span>
          <Segmented label="Engine" size="sm" value={engine} onChange={setEngine} options={[{ value: "Veo 3", label: "Veo 3" }, { value: "Seedance 2.0", label: "Seedance 2.0" }]} />
        </div>
        <div>
          <p className="num mb-1 text-[11px] text-ink-3">Referências</p>
          <p className="num text-[12px] text-ink-2">{refs.map((r) => refShort(r.id)).join(" · ")}</p>
          <p className="mt-2 text-[12px] text-ink-3">Cada pedido entra na fila de preparação (transcrição e análise rodam em segundo plano). Replicação já existente só é aberta, não duplicada.</p>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Criadores ----------

/** Foto de perfil baixada por scripts/baixar-avatares.py; sem foto, cai na inicial. */
function CriadorAvatar({ username }: { username: string }) {
  const [falhou, setFalhou] = useState(false);
  if (falhou) return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken font-display text-[16px] italic text-ink-2" aria-hidden>{username.charAt(0).toUpperCase()}</span>;
  return <img src={`/media/avatars/${encodeURIComponent(username)}.jpg`} alt="" aria-hidden loading="lazy" onError={() => setFalhou(true)} className="size-9 shrink-0 rounded-full bg-sunken object-cover" />;
}

function Criadores({ facets }: { facets: FacetsResponse | null | undefined }) {
  const loc = useBgLocation();
  if (!facets) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} ratio="5/2" />)}</div>;
  const go = (f: Filters) => navigate(bibHref(loc.path, "todas", { f: JSON.stringify(f) }));
  return (
    <div>
      <p className="mb-4 max-w-[640px] text-[13px] text-ink-2">Quem fez as referências. As antigas coleções “@perfil” viraram este filtro e ficam ocultas na lista de quadros.</p>
      <ul className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {facets.sem_criador > 0 && (
          <li>
            <button type="button" onClick={() => go({ sem_criador: true })} className="flex w-full items-center gap-3 rounded-r3 border border-dashed border-line-2 bg-transparent p-3 text-left hover:border-ink-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-dashed border-ink-3 font-display text-[16px] italic text-ink-3" aria-hidden>?</span>
              <span className="min-w-0 flex-1"><span className="block font-medium italic">Sem criador</span><span className="block truncate text-[12px] text-ink-3">sem @ no Instagram · triar</span></span>
              <span className="num text-[13px] text-brasa-ink">{facets.sem_criador}</span>
            </button>
          </li>
        )}
        {facets.criador.map((c) => (
          <li key={c.username}>
            <button type="button" onClick={() => go({ creator: c.username })} className="flex w-full items-center gap-3 rounded-r3 border border-line bg-card p-3 text-left hover:border-ink-3">
              <CriadorAvatar username={c.username} />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">@{c.username}</span><span className="block truncate text-[12px] text-ink-3">{c.display_name ?? "nome não disponível"}</span></span>
              <span className="num text-[13px] text-ink-2">{c.n}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- exports antigos (App.tsx atual e Clients.tsx) ----------

/** Wrapper fino: mantém a assinatura antiga e renderiza a Biblioteca nova. */
export function Library({ title, scope = {}, header, emptyHint }: { title: ReactNode; scope?: Scope; header?: ReactNode; emptyHint?: ReactNode }) {
  if (scope.client) {
    return <Grade scope={scope} header={header} emptyHint={emptyHint} title={<h2 className="title-serif mb-4 text-[22px]">{title}</h2>} />;
  }
  if (scope.collection) return <Biblioteca aba="quadros" quadro={scope.collection} />;
  if (scope.favorite) return <Biblioteca aba="favoritas" />;
  return <Biblioteca aba="todas" />;
}


/** Criar um valor novo (formato, estilo…) direto no lote; já aplica nas selecionadas. */
function NovoValorLote({ label, onCreate }: { label: string; onCreate: (name: string) => Promise<void> }) {
  const [v, setV] = useState("");
  return (
    <form className="mt-1 flex gap-1 border-t border-line px-1 pt-2" onSubmit={async (e) => { e.preventDefault(); const n = v.trim(); if (n) { await onCreate(n); setV(""); } }}>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`Novo ${label.toLowerCase()}`} aria-label={`Novo ${label}`} className="field h-9 min-w-0 flex-1 text-[13px]" />
      <Button type="submit" size="sm" variant="secondary">Criar</Button>
    </form>
  );
}
