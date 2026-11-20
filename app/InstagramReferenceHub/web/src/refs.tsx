import { Check, Images, MessageCircle, Play, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RefCard, RefPipeline, Stage } from "../../server/types";
import { STAGE_LABEL } from "../../server/types";
import { StageBadge } from "./components/StageBadge";
import { act, api, fmtCompact, fmtDate, fmtDuration, media, openRef, stageRank, store, useApi, useLocation, useStore } from "./lib";
import { Button, CheckList, cx, Popover } from "./ui";

/** Densidade antiga (Dashboard). "confortavel" = Grade, "compacta" = só mídia + selo. */
export type Density = "confortavel" | "compacta";
/** Densidades da Biblioteca (SPEC §4.4). */
export type Densidade = "grade" | "compacta" | "lista";

type Named = { id: number; name: string; ativo?: boolean };

// ---------- helpers de dados ----------

export function toggleFavorite(r: { id: string; favorite: boolean }) {
  const next = !r.favorite;
  const patch = (favorite: boolean) => api(`/api/refs/${r.id}`, { method: "PATCH", json: { favorite } });
  return act(() => patch(next), next ? "Adicionada às favoritas" : "Removida das favoritas", () => patch(!next));
}

/** ID completo: REF-0017 existe em mais de um mês, então cortar a data deixa o nome ambíguo. */
export const refShort = (id: string) => id;

/** Primeiro valor de um eixo de faceta (formato, objetivo…). */
export const facetOf = (r: Pick<RefCard, "facets">, key: string) => r.facets?.[key]?.[0] ?? null;

/** Proporção da moldura: reel 9/16, carrossel 3/4, foto 1/1 ou a medida real. */
export function mediaRatio(r: Pick<RefCard, "kind" | "width" | "height">) {
  if (r.kind === "video") return "9/16";
  if (r.kind === "carrossel") return "3/4";
  return r.width && r.height ? `${r.width}/${r.height}` : "1/1";
}

/** Iniciais de um nome ("Bruno Goytacazes" → "BG"). */
export function initials(name: string) {
  const p = name.replace(/^(nutri|dr\.?|dra\.?)\s+/i, "").split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** Linha do ciclo mostrada no card: a mais avançada (regra 9 de §3.2) e quantas outras há. */
export function cardStage(r: Pick<RefCard, "stage" | "pipeline">): { stage: Stage; sub?: string; late: boolean; more: number; top: RefPipeline | null } {
  const list = r.pipeline ?? [];
  if (!list.length) return { stage: r.stage ?? "guardada", late: false, more: 0, top: null };
  const top = [...list].sort((a, b) => stageRank(b.stage) - stageRank(a.stage))[0];
  return { stage: top.stage, sub: pipeSub(top), late: list.some((p) => p.late), more: list.length - 1, top };
}

/** Sub-rótulo do estágio de uma linha de produção ("Edição 7/7", "Análise", "ver ↗", "27/10 17:30"). */
export function pipeSub(p: RefPipeline) {
  if (p.etapa === "analise") return "Análise";
  if (p.stage === "postada") return p.postUrl ? "ver ↗" : p.sub || undefined;
  return p.sub || undefined;
}

// ---------- seleção (compartilhada entre grade, lista, BatchBar e Triagem) ----------

export const selection = store<string[]>([]);
export const useSelection = () => useStore(selection);
export function toggleSelected(id: string) {
  selection.set((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
}
export const clearSelection = () => selection.set([]);

// ---------- card de referência (SPEC §4.4) ----------

/** Card `.refcard`: moldura de post (9:16 reel · 3:4 carrossel), @ por cima, ciclo + REF embaixo. Sem <select>. */
export function RefCardView({ r, density = "grade" }: { r: RefCard; density?: "grade" | "compacta" }) {
  const sel = useSelection();
  const loc = useLocation();
  const selected = sel.includes(r.id);
  const open = loc.path === `/ref/${r.id}`;
  const [preview, setPreview] = useState(false);
  const timer = useRef<number>(0);
  const start = () => { if (r.video_path && matchMedia("(hover: hover)").matches) timer.current = window.setTimeout(() => setPreview(true), 220); };
  const stop = () => { clearTimeout(timer.current); setPreview(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const st = cardStage(r);
  const fmt = facetOf(r, "formato");
  const handle = r.username ? `@${r.username}` : null;
  const compact = density === "compacta";
  const profiles = uniqueClients(r);

  return (
    <article
      className={cx("refcard group relative min-w-0", selected && "is-selected")}
      data-ref={r.id}
      aria-label={`${r.id}${handle ? ` de ${handle}` : ""}`}
    >
      <div
        className={cx(
          "relative overflow-hidden rounded-r2 bg-media-bg img-outline transition-shadow duration-150",
          selected ? "ring-2 ring-brasa ring-offset-2 ring-offset-paper" : open ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : "",
        )}
        style={{ aspectRatio: mediaRatio(r) }}
        onMouseEnter={start}
        onMouseLeave={stop}
      >
        <button
          type="button"
          data-card-open=""
          onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) { e.preventDefault(); toggleSelected(r.id); return; } openRef(r.id); }}
          onFocus={start}
          onBlur={stop}
          aria-label={`Abrir ${refShort(r.id)}${handle ? ` de ${handle}` : " sem @"}`}
          className="absolute inset-0 z-[1] block size-full cursor-pointer rounded-r2 focus-visible:outline-offset-[-2px]"
        >
          {r.thumb_path ? (
            <img src={media(r.thumb_path)} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 size-full object-cover" />
          ) : (
            <span className="absolute inset-0 grid place-items-center text-ink-3"><Play size={26} strokeWidth={1.25} /></span>
          )}
          {preview && r.video_path && (
            <video src={media(r.video_path)} muted loop playsInline autoPlay preload="none" className="fade-in absolute inset-0 size-full object-cover" />
          )}
        </button>

        {/* topo: @criador + seleção (gradiente só no topo e na base) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] flex items-start gap-1.5 bg-gradient-to-b from-black/60 to-transparent p-2 pb-6 text-white">
          {!compact && (
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] leading-5">
              <span className="grid size-5 shrink-0 place-items-center rounded-full border border-white/50 text-[10px] font-medium" aria-hidden>
                {handle ? r.username!.charAt(0).toUpperCase() : "?"}
              </span>
              {handle ? <span className="truncate font-medium">{handle}</span> : (
                <span className="truncate italic text-white/85">sem @{r.creator_guess ? <span className="not-italic text-white/70"> · @{r.creator_guess}?</span> : null}</span>
              )}
            </span>
          )}
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={selected ? `Tirar ${refShort(r.id)} da seleção` : `Selecionar ${refShort(r.id)}`}
            title="Selecionar (X)"
            onClick={(e) => { e.stopPropagation(); toggleSelected(r.id); }}
            className={cx(
              "pointer-events-auto ml-auto grid size-7 shrink-0 place-items-center rounded-r1 transition-opacity duration-150 [@media(pointer:coarse)]:size-9",
              selected ? "bg-brasa text-on-brasa opacity-100" : "border border-white/70 bg-black/30 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-80",
            )}
          >
            {selected && <Check size={15} strokeWidth={2.5} />}
          </button>
        </div>

        {/* base: ▶ duração ou ▢ 1/N + estrela */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-end gap-2 bg-gradient-to-t from-black/65 to-transparent p-2 pt-8 text-white">
          <span className="num inline-flex items-center gap-1 text-[11px]">
            {r.kind === "video" ? <><Play size={11} strokeWidth={2} className="fill-current" />{fmtDuration(r.duration)}</>
              : <><Images size={12} strokeWidth={1.75} />1/{Math.max(r.media_count || 1, 1)}</>}
          </span>
          {!compact && r.metrics?.likes != null && <span className="num text-[11px] text-white/75 max-sm:hidden" title={`Curtidas, coletadas em ${fmtDate(r.metrics.collected_at)}`}>♥ {fmtCompact(r.metrics.likes)}</span>}
          {!compact && r.metrics?.comments != null && <span className="num inline-flex items-center gap-0.5 text-[11px] text-white/75 max-sm:hidden" title={`Comentários, coletados em ${fmtDate(r.metrics.collected_at)}`}><MessageCircle size={11} strokeWidth={2} />{fmtCompact(r.metrics.comments)}</span>}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); toggleFavorite(r); }}
            aria-label={r.favorite ? "Remover das favoritas" : "Favoritar"}
            aria-pressed={r.favorite}
            title="Favoritar (F)"
            className={cx(
              "pointer-events-auto ml-auto grid size-7 place-items-center rounded-r1 transition-opacity duration-150 [@media(pointer:coarse)]:size-9",
              r.favorite ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            )}
          >
            <Star size={15} strokeWidth={1.75} className={r.favorite ? "fill-brasa text-brasa" : ""} />
          </button>
        </div>
      </div>

      <div className={cx("min-w-0 px-0.5", compact ? "mt-1.5" : "mt-2")}>
        <div className="flex min-w-0 items-center gap-2">
          <StageBadge stage={st.stage} sub={compact ? undefined : st.sub} late={st.late || undefined}
            className="min-w-0 overflow-hidden whitespace-nowrap [&>.st-sub]:min-w-0 [&>.st-sub]:truncate [&>.st-t]:shrink-0 [&_.g]:shrink-0" />
          {st.more > 0 && <span className="num shrink-0 text-[11px] text-ink-3" title={`${st.more + 1} perfis`}>+{st.more}</span>}
          {!compact && profiles.length > 0 && (
            <span className="ml-auto flex shrink-0 -space-x-1 max-sm:hidden" aria-label={`Experts: ${profiles.map((c) => c.name).join(", ")}`}>
              {profiles.slice(0, 3).map((c) => (
                <span key={c.id} title={c.name} className="grid size-5 place-items-center rounded-full border border-paper bg-sunken text-[9px] font-semibold text-ink-2">{initials(c.name)}</span>
              ))}
            </span>
          )}
        </div>
        {!compact && (
          <div className="num mt-1 truncate text-[12px] text-ink-3" title={r.id}>
            <span className="text-ink-2">{refShort(r.id)}</span>
            <span className="max-sm:hidden"> · {fmt ? fmt.name : <span className="italic">sem formato</span>}</span>
          </div>
        )}
      </div>
    </article>
  );
}

/** Mantido para quem ainda importa o nome antigo. */
export const RefTile = ({ r, density = "confortavel" }: { r: RefCard; density?: Density }) => <RefCardView r={r} density={density === "compacta" ? "compacta" : "grade"} />;

function uniqueClients(r: Pick<RefCard, "clients" | "pipeline">) {
  const map = new Map<number, { id: number; name: string }>();
  for (const p of r.pipeline ?? []) map.set(p.client.id, { id: p.client.id, name: p.client.name });
  for (const c of r.clients ?? []) if (!map.has(c.id)) map.set(c.id, c);
  return [...map.values()];
}

// ---------- renderização em blocos ----------

/** Renderiza `step` itens por vez; um sentinela (IntersectionObserver) libera o próximo bloco. */
export function useChunks(total: number, step = 60, resetKey?: unknown) {
  const [n, setN] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setN(step), [resetKey, step]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || n >= total) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setN((v) => Math.min(total, v + step)); }, { rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [n, total, step]);
  return { shown: Math.min(n, total), sentinel };
}

export function RefGrid({ items, density = "confortavel" }: { items: RefCard[]; density?: Density | Densidade }) {
  const compact = density === "compacta";
  const { shown, sentinel } = useChunks(items.length, 60, items);
  return (
    <>
      <div
        className={cx(
          "grid",
          compact
            ? "grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))]"
            : "grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] sm:gap-x-3.5 sm:gap-y-[22px]",
        )}
      >
        {items.slice(0, shown).map((r) => <RefCardView key={r.id} r={r} density={compact ? "compacta" : "grade"} />)}
      </div>
      {shown < items.length && <div ref={sentinel} className="num py-6 text-center text-[12px] text-ink-3">Mostrando {shown} de {items.length}…</div>}
    </>
  );
}

// ---------- produção por expert (lista e viewer) ----------

/** Uma linha por perfil com StageBadge (enxerto da Clareza). Sem destino → "Sem destino" + Atribuir. */
export function ProducaoLinhas({ r, compact }: { r: RefCard; compact?: boolean }) {
  const pipes = r.pipeline ?? [];
  const semReplicacao = (r.clients ?? []).filter((c) => !pipes.some((p) => p.client.id === c.id));
  if (!pipes.length && !semReplicacao.length) {
    return (
      <div className="flex items-center gap-2">
        <StageBadge stage={r.stage ?? "guardada"} label="Sem destino" />
        <AtribuirExpert r={r} />
      </div>
    );
  }
  return (
    <ul className={cx("flex flex-col", compact ? "gap-0.5" : "gap-1")}>
      {pipes.map((p) => (
        <li key={p.id} className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sunken text-[9px] font-semibold text-ink-2" aria-hidden>{initials(p.client.name)}</span>
          <span className="min-w-0 truncate text-ink-2">{p.client.name}</span>
          <StageBadge stage={p.stage} sub={pipeSub(p)} late={p.late || undefined} href={p.stage === "postada" && p.postUrl ? p.postUrl : undefined} className="shrink-0" />
        </li>
      ))}
      {semReplicacao.map((c) => (
        <li key={`c${c.id}`} className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sunken text-[9px] font-semibold text-ink-2" aria-hidden>{initials(c.name)}</span>
          <span className="min-w-0 truncate text-ink-2">{c.name}</span>
          <StageBadge stage="atribuida" className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

/** Atribuir a um expert (ref_clients). Não cria replicação. */
export function AtribuirExpert({ r, label = "Atribuir", size = "sm" }: { r: Pick<RefCard, "id" | "clients">; label?: string; size?: "sm" | "md" }) {
  const experts = useApi<Named[]>("/api/clients").data;
  const ids = (r.clients ?? []).map((c) => c.id);
  return (
    <Popover width={260} trigger={({ toggle, open }) => <Button size={size} variant="secondary" aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(); }}>{label}</Button>}>
      {() => experts ? (
        <CheckList
          options={experts.filter(e => e.ativo !== false || ids.includes(e.id)).map((e) => ({ value: e.id, label: e.name + (e.ativo === false ? " (inativo)" : "") }))}
          value={ids}
          empty="Nenhum expert cadastrado."
          onChange={(v) => act(
            () => api(`/api/refs/${r.id}`, { method: "PATCH", json: { clients: v } }),
            v.length > ids.length ? "Expert atribuído" : "Atribuição removida",
            () => api(`/api/refs/${r.id}`, { method: "PATCH", json: { clients: ids } }),
          )}
        />
      ) : <p className="pop-empty">Carregando experts…</p>}
    </Popover>
  );
}

// ---------- lista (densidade "Lista", 36 px) ----------

export function RefList({ items }: { items: RefCard[] }) {
  const sel = useSelection();
  const { shown, sentinel } = useChunks(items.length, 60, items);
  const all = items.length > 0 && items.every((r) => sel.includes(r.id));
  return (
    <div className="overflow-x-auto rounded-r3 border border-line bg-card">
      <table className="w-full min-w-[760px] text-left text-[13px]">
        <thead className="border-b border-line">
          <tr className="num text-[10px] tracking-[.12em] text-ink-3 uppercase">
            <th className="w-10 py-2.5 pl-3 font-normal">
              <input type="checkbox" aria-label={all ? "Tirar todas da seleção" : "Selecionar todas"} checked={all}
                onChange={() => selection.set(all ? [] : items.map((r) => r.id))} className="size-4 accent-[var(--brasa)]" />
            </th>
            <th className="py-2.5 font-normal whitespace-nowrap">Referência</th>
            <th className="font-normal whitespace-nowrap">Formato · Objetivo</th>
            <th className="font-normal whitespace-nowrap">Produção</th>
            <th className="pr-4 text-right font-normal whitespace-nowrap">Importada</th>
          </tr>
        </thead>
        <tbody>
          {items.slice(0, shown).map((r) => {
            const on = sel.includes(r.id);
            return (
              <tr key={r.id} className={cx("refcard border-b border-line last:border-0 hover:bg-sunken", on && "bg-brasa-wash")}>
                <td className="py-1.5 pl-3 align-middle">
                  <input type="checkbox" checked={on} onChange={() => toggleSelected(r.id)} aria-label={`Selecionar ${refShort(r.id)}`} className="size-4 accent-[var(--brasa)]" />
                </td>
                <td className="py-1.5 pr-4">
                  <button type="button" data-card-open="" onClick={() => openRef(r.id)} className="flex min-w-0 items-center gap-3 text-left">
                    <span className="img-outline relative h-12 w-[27px] shrink-0 overflow-hidden rounded-r1 bg-media-bg">
                      {r.thumb_path && <img src={media(r.thumb_path)} alt="" loading="lazy" className="size-full object-cover" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium">
                        {r.favorite && <Star size={12} className="fill-brasa text-brasa" aria-label="Favorita" />}
                        {r.username ? `@${r.username}` : <span className="italic text-ink-3">sem @</span>}
                      </span>
                      <span className="num block text-[11px] text-ink-3" title={r.id}>{refShort(r.id)} · {r.kind === "video" ? fmtDuration(r.duration) : `${r.media_count || 1} slides`}</span>
                    </span>
                  </button>
                </td>
                <td className="pr-4 text-ink-2">
                  {facetOf(r, "formato")?.name ?? <span className="italic text-ink-3">sem formato</span>}
                  <span className="text-ink-3"> · </span>
                  {facetOf(r, "objetivo")?.name ?? <span className="italic text-ink-3">sem objetivo</span>}
                </td>
                <td className="py-1.5 pr-4"><ProducaoLinhas r={r} compact /></td>
                <td className="num pr-4 text-right text-[12px] whitespace-nowrap text-ink-3">{fmtDate(r.imported_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown < items.length && <div ref={sentinel} className="num py-4 text-center text-[12px] text-ink-3">Mostrando {shown} de {items.length}…</div>}
    </div>
  );
}

// ---------- agrupamento por ciclo ----------

const GROUP_ORDER: Stage[] = ["postada", "agendada", "pronta", "producao", "atribuida", "triada", "guardada"];

/** Agrupa por estágio do card (usado quando há filtro de expert). */
export function useStageGroups(items: RefCard[]) {
  return useMemo(() => GROUP_ORDER
    .map((s) => ({ stage: s, label: STAGE_LABEL[s], items: items.filter((r) => cardStage(r).stage === s) }))
    .filter((g) => g.items.length), [items]);
}

export function GroupTitle({ children, n, hint }: { children: ReactNode; n: number; hint?: string }) {
  return (
    <h2 className="mt-8 mb-3 flex items-baseline gap-2 first:mt-2">
      <span className="title-serif text-[20px]">{children}</span>
      <span className="num text-[12px] text-ink-3">{n}{hint ? ` · ${hint}` : ""}</span>
    </h2>
  );
}
