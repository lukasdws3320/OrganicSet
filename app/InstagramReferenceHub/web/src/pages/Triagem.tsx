import { Archive, ArrowLeft, ArrowRight, Check, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FacetsResponse, RefCard } from "../../../server/types";
import { InstagramPost, type PostData } from "../components/InstagramPost";
import { act, api, apiUrl, isTyping, media, openRef, refsUrl, toast, useApi } from "../lib";
import { facetOf, mediaRatio, refShort } from "../refs";
import { Button, cx, Empty, ErrorState, Skeleton } from "../ui";

/** Tag (oculta na UI) que tira a referência da fila de triagem sem apagar nada. Reversível com Desfazer. */
export const TAG_ARQUIVADA = "triagem-arquivada";

type TagRow = { id: number; name: string; ref_count: number };

/**
 * Fila de triagem: referências "Guardadas" (sem formato + objetivo, sem expert, sem replicação),
 * menos as arquivadas na triagem. Mesma regra para a contagem da aba e para a tela.
 */
export function useTriagemFila() {
  const tags = useApi<TagRow[]>("/api/tags");
  const tagId = tags.data?.find((t) => t.name === TAG_ARQUIVADA)?.id ?? null;
  const guardadas = useApi<{ items: RefCard[]; total: number }>(refsUrl({ stage: ["guardada"], sort: "recentes" }));
  const arquivadas = useApi<{ items: RefCard[] }>(tagId ? refsUrl({ tags: [tagId] }) : null);
  const items = useMemo(() => {
    if (!guardadas.data) return null;
    const fora = new Set((arquivadas.data?.items ?? []).map((r) => r.id));
    return guardadas.data.items.filter((r) => !fora.has(r.id));
  }, [guardadas.data, arquivadas.data]);
  const ready = !!items && !!tags.data && (!tagId || !!arquivadas.data);
  return { items: ready ? items : null, total: ready ? items!.length : null, error: guardadas.error ?? tags.error ?? arquivadas.error, reload: guardadas.reload };
}

type Escolha = { formato: number | null; objetivo: number | null; criador: string };
const CAMPOS = ["formato", "objetivo", "criador"] as const;
type Campo = (typeof CAMPOS)[number];

/** Triagem (SPEC §5.2): um item por vez. 1-9 escolhe no campo ativo, Enter salva e avança, E arquiva, S pula. */
export function Triagem() {
  const fila = useTriagemFila();
  const facets = useApi<FacetsResponse>(apiUrl.facets(true)).data;
  // A fila da sessão é congelada na primeira leitura: classificar não reordena nem "pula" itens.
  const [sessao, setSessao] = useState<RefCard[] | null>(null);
  const [feitos, setFeitos] = useState<Record<string, "salva" | "arquivada" | "pulada">>({});
  const [i, setI] = useState(0);
  useEffect(() => { if (fila.items && !sessao) setSessao(fila.items); }, [fila.items, sessao]);

  const formatos = facets?.facets.find((f) => f.key === "formato")?.values ?? [];
  const objetivos = facets?.facets.find((f) => f.key === "objetivo")?.values ?? [];
  const lista = sessao ?? [];
  const r = lista[i] ?? null;
  const restantes = lista.filter((x) => !feitos[x.id] || feitos[x.id] === "pulada").length;

  const [esc, setEsc] = useState<Escolha>({ formato: null, objetivo: null, criador: "" });
  const [campo, setCampo] = useState<Campo>("formato");
  const [busy, setBusy] = useState(false);
  const criadorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!r) return;
    setEsc({ formato: facetOf(r, "formato")?.id ?? null, objetivo: facetOf(r, "objetivo")?.id ?? null, criador: r.username ? "" : r.creator_guess ?? "" });
    setCampo(facetOf(r, "formato") ? (facetOf(r, "objetivo") ? "criador" : "objetivo") : "formato");
  }, [r?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const proximo = useCallback(() => {
    setI((k) => {
      for (let j = k + 1; j < lista.length; j++) if (!feitos[lista[j].id] || feitos[lista[j].id] === "pulada") return j;
      return Math.min(k + 1, lista.length);
    });
  }, [lista, feitos]);

  const salvar = useCallback(async () => {
    if (!r || busy) return;
    const facetsPatch: Record<string, number[]> = {};
    if (esc.formato) facetsPatch.formato = [esc.formato];
    if (esc.objetivo) facetsPatch.objetivo = [esc.objetivo];
    const antes = { facets: { formato: (r.facets?.formato ?? []).map((v) => v.id), objetivo: (r.facets?.objetivo ?? []).map((v) => v.id) }, creator_guess: r.creator_guess };
    const patch: Record<string, unknown> = {};
    if (Object.keys(facetsPatch).length) patch.facets = facetsPatch;
    const guess = esc.criador.trim().replace(/^@/, "");
    if (!r.username && guess !== (r.creator_guess ?? "")) patch.creator_guess = guess || null;
    if (!Object.keys(patch).length) { toast("Nada escolhido: use S para pular ou E para arquivar"); return; }
    setBusy(true);
    const ok = await act(() => api(`/api/refs/${r.id}`, { method: "PATCH", json: patch }), `${refShort(r.id)} triada`,
      () => api(`/api/refs/${r.id}`, { method: "PATCH", json: antes }));
    setBusy(false);
    if (ok) { setFeitos((f) => ({ ...f, [r.id]: "salva" })); proximo(); }
  }, [r, esc, busy, proximo]);

  const arquivar = useCallback(async () => {
    if (!r || busy) return;
    setBusy(true);
    const ok = await act(async () => {
      const d = await api<{ tags: { name: string }[] }>(`/api/refs/${r.id}`);
      const nomes = d.tags.map((t) => t.name);
      await api(`/api/refs/${r.id}`, { method: "PATCH", json: { tags: [...new Set([...nomes, TAG_ARQUIVADA])] } });
      return nomes;
    }, `${refShort(r.id)} arquivada (sai da triagem, continua na biblioteca)`, async () => {
      const d = await api<{ tags: { name: string }[] }>(`/api/refs/${r.id}`);
      await api(`/api/refs/${r.id}`, { method: "PATCH", json: { tags: d.tags.map((t) => t.name).filter((n) => n !== TAG_ARQUIVADA) } });
      setFeitos((f) => { const n = { ...f }; delete n[r.id]; return n; });
    });
    setBusy(false);
    if (ok) { setFeitos((f) => ({ ...f, [r.id]: "arquivada" })); proximo(); }
  }, [r, busy, proximo]);

  const pular = useCallback(() => { if (r) { setFeitos((f) => ({ ...f, [r.id]: "pulada" })); proximo(); } }, [r, proximo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (location.pathname.startsWith("/ref/") || document.querySelector(".modal") || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = isTyping(e);
      if (e.key === "Enter" && (!typing || e.target === criadorRef.current)) { e.preventDefault(); salvar(); return; }
      if (typing) { if (e.key === "Escape") (e.target as HTMLElement).blur(); return; }
      const k = e.key.toLowerCase();
      if (/^[1-9]$/.test(e.key) && campo !== "criador") {
        const list = campo === "formato" ? formatos : objetivos;
        const v = list[Number(e.key) - 1];
        if (!v) return;
        e.preventDefault();
        setEsc((s) => ({ ...s, [campo]: s[campo] === v.id ? null : v.id }));
        const next: Campo = campo === "formato" ? "objetivo" : "criador";
        setCampo(next);
        if (next === "criador" && r && !r.username) requestAnimationFrame(() => criadorRef.current?.focus());
      } else if (k === "e") { e.preventDefault(); arquivar(); }
      else if (k === "s") { e.preventDefault(); pular(); }
      else if (e.key === "Tab" && !e.shiftKey && document.activeElement === document.body) { e.preventDefault(); setCampo((c) => CAMPOS[(CAMPOS.indexOf(c) + 1) % 3]); }
      else if (e.key === "ArrowLeft" && (e.target as HTMLElement).closest?.(".ig-track") == null) setI((x) => Math.max(0, x - 1));
      else if (e.key === "ArrowRight" && (e.target as HTMLElement).closest?.(".ig-track") == null) setI((x) => Math.min(lista.length, x + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [campo, formatos, objetivos, salvar, arquivar, pular, r, lista.length]);

  if (fila.error && !sessao) return <ErrorState title="Não deu para carregar a fila de triagem" detail={fila.error} onRetry={fila.reload} />;
  if (!sessao) return <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]"><Skeleton ratio="9/16" /><Skeleton ratio="4/3" /></div>;
  if (!lista.length) {
    return <Empty title={<>Nada esperando <em>triagem</em></>}>Toda referência guardada já tem formato e objetivo, ou foi arquivada.</Empty>;
  }

  const inicial = lista.length;
  const progresso = (inicial - restantes) / inicial;

  if (!r) {
    return (
      <Empty title={<>Fila <em>percorrida</em></>} action={restantes > 0 ? <Button variant="primary" onClick={() => setI(lista.findIndex((x) => feitos[x.id] === "pulada"))}>Voltar às puladas ({restantes})</Button> : undefined}>
        {inicial - restantes} de {inicial} resolvidas nesta sessão.{restantes > 0 ? ` ${restantes} ficaram para depois.` : ""}
      </Empty>
    );
  }

  const post: PostData = {
    id: `tri-${r.id}`,
    chave: { ref: refShort(r.id) },
    perfil: { handle: r.username ?? null, nome: r.username ? undefined : "sem @" },
    formato: r.kind === "video" ? "reel" : r.kind === "carrossel" ? "carrossel" : "imagem",
    proporcao: mediaRatio(r),
    midia_video: r.video_path ? { src: media(r.video_path), poster: media(r.thumb_path), duracao_s: r.duration } : null,
    capa: media(r.thumb_path) ?? null,
    slides: r.kind === "carrossel" ? (r.media ?? []).map((m) => ({ n: m.position + 1, src: media(m.thumb ?? m.path) ?? null })) : undefined,
    total_previsto: r.kind === "carrossel" ? r.media_count : undefined,
    legenda: r.caption_head,
    contexto: r.display_name ?? undefined,
  };
  const estado = feitos[r.id];

  return (
    <div className="grid gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-10">
      <div className="min-w-0 md:sticky md:top-6 md:self-start">
        <InstagramPost key={r.id} post={post} compact />
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="title-serif text-[34px] leading-none tabular-nums">{restantes}</span>
            <span className="num shrink-0 text-[13px] whitespace-nowrap text-ink-2">→ 0</span>
            <span className="num text-[12px] text-ink-3">esperando triagem · {inicial - restantes} resolvidas nesta sessão</span>
          </div>
          <span className="num text-[12px] text-ink-3">item {Math.min(i + 1, inicial)} de {inicial}{estado ? ` · ${estado}` : ""}</span>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Triagem resolvida" aria-valuemin={0} aria-valuemax={inicial} aria-valuenow={inicial - restantes}>
          <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${progresso * 100}%` }} />
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button type="button" onClick={() => openRef(r.id)} className="num text-[13px] text-ink-2 underline-offset-4 hover:underline" title={r.id}>{refShort(r.id)}</button>
          <span className="truncate text-[13px] text-ink-3">{r.username ? `@${r.username}` : "sem @"} · {r.caption_head.slice(0, 80)}</span>
        </div>

        <Campo titulo="Formato" atalho="1-9" ativo={campo === "formato"} onAtivar={() => setCampo("formato")}>
          <Opcoes valores={formatos} valor={esc.formato} numerado={campo === "formato"} onPick={(id) => { setEsc((s) => ({ ...s, formato: s.formato === id ? null : id })); setCampo("objetivo"); }} />
        </Campo>
        <Campo titulo="Objetivo" atalho="1-9" ativo={campo === "objetivo"} onAtivar={() => setCampo("objetivo")}>
          <Opcoes valores={objetivos} valor={esc.objetivo} numerado={campo === "objetivo"} onPick={(id) => { setEsc((s) => ({ ...s, objetivo: s.objetivo === id ? null : id })); setCampo("criador"); }} />
        </Campo>
        <Campo titulo="Criador" ativo={campo === "criador"} onAtivar={() => { setCampo("criador"); criadorRef.current?.focus(); }}>
          {r.username ? (
            <p className="text-[14px]"><span className="tagv">@{r.username}</span> <span className="ml-1 text-[12px] text-ink-3">veio do Instagram</span></p>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="sr">@ do criador (sugestão)</span>
              <input ref={criadorRef} className="field max-w-[320px]" placeholder="@criador (fica marcado como sugestão ?)" value={esc.criador}
                onFocus={() => setCampo("criador")} onChange={(e) => setEsc((s) => ({ ...s, criador: e.target.value }))} />
              <span className="text-[12px] text-ink-3">Sem @ no Instagram. O que você digitar fica como sugestão até confirmar no viewer.</span>
            </label>
          )}
        </Campo>

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-line pt-5">
          <Button variant="primary" icon={<Check size={16} />} kbd="↵" busy={busy} busyLabel="Salvando…" onClick={salvar}>Salvar e próxima</Button>
          <Button variant="secondary" icon={<SkipForward size={16} />} kbd="S" onClick={pular}>Pular</Button>
          <Button variant="ghost" icon={<Archive size={16} />} kbd="E" onClick={arquivar}>Arquivar</Button>
          <span className="ml-auto flex gap-1">
            <Button variant="icon" aria-label="Item anterior" title="Item anterior (←)" onClick={() => setI((x) => Math.max(0, x - 1))} disabledReason={i === 0 ? "É o primeiro da fila" : undefined}><ArrowLeft size={16} /></Button>
            <Button variant="icon" aria-label="Próximo item" title="Próximo item (→)" onClick={() => setI((x) => Math.min(inicial, x + 1))}><ArrowRight size={16} /></Button>
          </span>
        </div>
        <p className="num mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3">
          <span><kbd>1</kbd>–<kbd>9</kbd> escolhe no campo ativo</span>
          <span><kbd>↵</kbd> salva</span>
          <span><kbd>S</kbd> pula</span>
          <span><kbd>E</kbd> arquiva</span>
          <span><kbd>←</kbd><kbd>→</kbd> navega</span>
        </p>
      </div>
    </div>
  );
}

function Campo({ titulo, atalho, ativo, onAtivar, children }: { titulo: string; atalho?: string; ativo: boolean; onAtivar: () => void; children: ReactNode }) {
  return (
    <section className={cx("mt-5 rounded-r3 border p-4 transition-colors", ativo ? "border-ink bg-card" : "border-line")} onClick={onAtivar}>
      <h3 className="mb-3 flex items-baseline gap-2">
        <span className="text-[14px] font-semibold">{titulo}</span>
        {ativo && atalho && <span className="num text-[11px] text-brasa-ink">teclas {atalho}</span>}
      </h3>
      {children}
    </section>
  );
}

function Opcoes({ valores, valor, numerado, onPick }: { valores: { id: number; name: string; n: number }[]; valor: number | null; numerado: boolean; onPick: (id: number) => void }) {
  if (!valores.length) return <p className="text-[13px] text-ink-3">Carregando valores…</p>;
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {valores.map((v, k) => {
        const on = valor === v.id;
        return (
          <button key={v.id} type="button" role="radio" aria-checked={on} onClick={(e) => { e.stopPropagation(); onPick(v.id); }}
            className={cx("inline-flex min-h-[var(--hit)] items-center gap-2 rounded-r2 border px-3 text-[13px] transition-colors",
              on ? "border-ink bg-ink text-on-ink" : "border-line-2 bg-card text-ink hover:border-ink-3")}>
            {numerado && k < 9 && <kbd className={on ? "!border-on-ink/40 !text-on-ink" : ""}>{k + 1}</kbd>}
            {v.name}
            <span className={cx("num text-[11px]", on ? "text-on-ink/70" : "text-ink-3")}>{v.n}</span>
          </button>
        );
      })}
    </div>
  );
}
