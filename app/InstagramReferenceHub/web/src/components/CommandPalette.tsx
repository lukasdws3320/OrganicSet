import {
  ArrowDownToLine, Clapperboard, Copy, Film, Hash, Keyboard, LayoutGrid, ListChecks, Moon, Search, Sparkles, Sun, User, Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PipelineResponse, Profile, RefCard } from "../../../server/types";
import { STAGE_LABEL } from "../../../server/types";
import { api, apiUrl, copy, navigate, openRef, refsUrl, setTheme, theme, toast, useApi, useStore } from "../lib";
import { estudioHref, expertHref, personagemCurto, producaoHref } from "../replication-experts";
import { idDigits, refsPorId } from "../ref-id";
import { refShort } from "../refs";
import { cx } from "../ui";

/**
 * Paleta ⌘K (SPEC §5.2): Ações · Ir para · Referências · Experts · Quadros.
 * - ID parcial ("0163", "REF0163", "REF-2026-10-0163") abre a referência;
 * - "bruno" lista o perfil, a produção dele e as referências atribuídas aos personagens;
 * - texto livre usa a busca da biblioteca (FTS).
 */

export type PaletteNav = { to: string; label: string; icon: typeof Search; hint?: string };

type Item = { group: string; label: ReactNode; text: string; hint?: string; icon?: ReactNode; run: () => void };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const ICON = { size: 16, strokeWidth: 1.5 } as const;

export function CommandPalette({ nav, onClose, onImportar, onAtalhos, onReplicar, viewerId }: {
  nav: PaletteNav[];
  onClose: () => void;
  onImportar: () => void;
  onAtalhos: () => void;
  /** Nova replicação da referência aberta no viewer. */
  onReplicar: (refId: string) => void;
  viewerId: string | null;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const t = useStore(theme);

  const profiles = useApi<Profile[]>(apiUrl.profiles()).data ?? [];
  const collections = (useApi<{ id: number; name: string; kind: string }[]>("/api/collections").data ?? []).filter((c) => !c.name.startsWith("@"));
  const all = useApi<{ items: RefCard[] }>("/api/refs").data?.items ?? [];
  const pipeline = useApi<PipelineResponse>(apiUrl.pipeline()).data?.itens ?? [];
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const h = setTimeout(() => setDebounced(q.trim()), 150); return () => clearTimeout(h); }, [q]);
  const fts = useApi<{ items: RefCard[] }>(debounced.length >= 2 && !idDigits(debounced) ? refsUrl({ q: debounced }) : null).data?.items ?? [];

  const items = useMemo<Item[]>(() => {
    const nq = norm(q);
    const match = (...s: (string | null | undefined)[]) => !nq || s.some((x) => x && norm(x).includes(nq));
    const out: Item[] = [];
    const close = (fn: () => void) => () => { onClose(); fn(); };
    const refItem = (group: string, r: RefCard, hint?: string): Item => ({
      group, text: r.id,
      label: <><span className="num text-[12px]">{refShort(r.id)}</span> <span className="text-ink-3">·</span> {r.username ? `@${r.username}` : <i className="text-ink-3">sem @</i>} <span className="text-ink-3">{r.caption_head.slice(0, 48)}</span></>,
      hint: hint ?? (typeof r.formato === "string" ? r.formato : r.formato?.name) ?? undefined, icon: <Clapperboard {...ICON} />, run: close(() => openRef(r.id)),
    });

    // Referências por ID: vêm primeiro quando a busca parece um ID.
    const dig = idDigits(q);
    if (dig) {
      const pad = dig.padStart(4, "0");
      refsPorId(all, q).forEach((r) => out.push(refItem("Referências", r, r.legacy_id && norm(r.legacy_id) === `ref${pad}` ? `antiga ${r.legacy_id}` : undefined)));
    }

    // Ações
    const acoes: Item[] = [
      { group: "Ações", text: "Importar link importar", label: "Importar link", hint: "⌘I", icon: <ArrowDownToLine {...ICON} />, run: close(onImportar) },
      { group: "Ações", text: "Triar agora triagem", label: "Triar agora", hint: "T", icon: <ListChecks {...ICON} />, run: close(() => navigate("/biblioteca?aba=triagem")) },
      ...(viewerId ? [
        { group: "Ações", text: `Nova replicação ${viewerId} replicar`, label: <>Nova replicação de <span className="num text-[12px]">{refShort(viewerId)}</span></>, icon: <Film {...ICON} />, run: close(() => onReplicar(viewerId)) },
        { group: "Ações", text: `Copiar legenda ${viewerId}`, label: <>Copiar legenda de <span className="num text-[12px]">{refShort(viewerId)}</span></>, icon: <Copy {...ICON} />,
          run: close(() => { api<{ caption?: string }>(apiUrl.ref(viewerId)).then((r) => { if (r.caption) void copy(r.caption, "Legenda copiada"); else toast("Esta referência não tem legenda", "erro"); }).catch(() => toast("Não deu para ler a referência", "erro")); }) },
      ] : []),
      { group: "Ações", text: "Alternar tema claro escuro", label: t === "dark" ? "Tema claro" : "Tema escuro", icon: t === "dark" ? <Sun {...ICON} /> : <Moon {...ICON} />, run: close(() => setTheme(t === "dark" ? "light" : "dark")) },
      { group: "Ações", text: "Atalhos de teclado", label: "Atalhos de teclado", hint: "?", icon: <Keyboard {...ICON} />, run: close(onAtalhos) },
    ];
    acoes.filter((a) => match(a.text)).forEach((a) => out.push(a));

    // Ir para
    nav.filter((n) => match(n.label, n.hint)).forEach((n) => out.push({ group: "Ir para", text: n.label, label: n.label, hint: n.hint, icon: <n.icon {...ICON} />, run: close(() => navigate(n.to)) }));

    // Experts (perfil → página, produção e refs atribuídas)
    if (nq) {
      const achados = profiles.filter((p) => match(p.name, p.slug, ...p.aliases, ...p.personagens.flatMap((c) => [c.name, c.slug])));
      for (const p of achados.slice(0, 3)) {
        const ids = new Set(p.personagens.map((c) => c.id));
        const atribuidas = all.filter((r) => r.clients.some((c) => ids.has(c.id)));
        out.push({ group: "Experts", text: p.name, label: p.name, hint: `${p.ref_count} refs · ${p.replicacoes} replicações`, icon: <User {...ICON} />, run: close(() => navigate(expertHref(p, "visao", true))) });
        out.push({ group: "Experts", text: `Produção ${p.name}`, label: <>Produção de {p.name}</>, icon: <LayoutGrid {...ICON} />, run: close(() => navigate(producaoHref(p.slug, null, true))) });
        pipeline.filter((it) => it.profile_slug === p.slug && it.stage !== "postada").slice(0, 3).forEach((it) =>
          out.push({ group: "Experts", text: it.id, label: <>Estúdio · <span className="num text-[12px]">{refShort(it.ref)}</span> · {personagemCurto(p.name, it.client_name ?? "")}</>, hint: [STAGE_LABEL[it.stage], it.sub].filter(Boolean).join(" · "), icon: <Film {...ICON} />, run: close(() => navigate(estudioHref(it.id, "referencia", true))) }));
        const g = `Atribuídas a ${p.name}`;
        atribuidas.slice(0, 8).forEach((r) => out.push(refItem(g, r, STAGE_LABEL[r.stage] ?? r.stage)));
        if (atribuidas.length) {
          const to = `/biblioteca?f=${encodeURIComponent(JSON.stringify({ profile: p.slug }))}`;
          out.push({ group: g, text: to, label: `Ver as ${atribuidas.length} na Biblioteca`, icon: <Search {...ICON} />, run: close(() => navigate(to)) });
        }
      }
    }

    // @criador
    if (nq.startsWith("@") && nq.length > 1) {
      const u = nq.slice(1);
      all.filter((r) => r.username && norm(r.username).includes(u)).slice(0, 6).forEach((r) => out.push(refItem("Referências", r)));
    }

    // Quadros
    if (nq) collections.filter((c) => match(c.name)).slice(0, 4).forEach((c) =>
      out.push({ group: "Quadros", text: c.name, label: c.name, icon: <Sparkles {...ICON} />, run: close(() => navigate(`/biblioteca?aba=quadros&quadro=${c.id}`)) }));

    // Texto livre (FTS)
    if (debounced && !dig) {
      const ja = new Set(out.map((o) => o.text));
      fts.filter((r) => !ja.has(r.id)).slice(0, 6).forEach((r) => out.push(refItem("Na legenda", r)));
      const to = `/biblioteca?f=${encodeURIComponent(JSON.stringify({ q: debounced }))}`;
      out.push({ group: "Buscar", text: to, label: <>Buscar “{debounced}” na Biblioteca</>, icon: <Search {...ICON} />, run: close(() => navigate(to)) });
    }
    return out;
  }, [q, debounced, all, fts, profiles, collections, pipeline, nav, t, viewerId, onClose, onImportar, onAtalhos, onReplicar]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  // Prende o foco no diálogo e devolve a quem abriu.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") { e.preventDefault(); input.current?.focus(); }
    };
    root.current?.addEventListener("keydown", onKey);
    const r = root.current;
    return () => { r?.removeEventListener("keydown", onKey); prev?.focus?.({ preventScroll: true }); };
  }, []);

  const run = (i: number) => items[i]?.run();
  const activeId = items[sel] ? `cmd-opt-${sel}` : undefined;

  return (
    <div ref={root} className="modal items-start! justify-items-center pt-[10vh]!" role="dialog" aria-modal aria-label="Buscar ou agir">
      <div className="modal-scrim fade-in" onClick={onClose} />
      <div className="fade-in relative w-full max-w-[600px] overflow-hidden rounded-r4 border border-line bg-card text-ink shadow-[var(--sh-2)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); run(sel); }
            }}
            placeholder="REF (0163), expert, @criador, ação ou texto da legenda"
            aria-label="Buscar ou agir"
            role="combobox"
            aria-expanded
            aria-controls="cmd-list"
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            className="h-14 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-ink-3 focus:outline-none"
          />
          <kbd className="num shrink-0 rounded-r1 border border-line px-1.5 text-[11px] text-ink-3">esc</kbd>
        </div>
        <ul ref={list} id="cmd-list" role="listbox" aria-label="Resultados" className="max-h-[min(60vh,520px)] overflow-auto p-2">
          {items.map((it, i) => (
            <li key={i} role="presentation">
              {(i === 0 || items[i - 1].group !== it.group) && <div className="eyebrow px-3 pt-3 pb-1 text-[10px]" role="presentation">{it.group}</div>}
              <div
                id={`cmd-opt-${i}`}
                data-i={i}
                role="option"
                aria-selected={sel === i}
                onMouseMove={() => sel !== i && setSel(i)}
                onClick={() => run(i)}
                className={cx("flex min-h-10 cursor-pointer items-center gap-3 rounded-r2 px-3 py-2 text-[14px]", sel === i ? "bg-sunken text-ink" : "text-ink-2")}
              >
                <span className="shrink-0 text-ink-3" aria-hidden>{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.hint && <span className="num shrink-0 text-[11px] text-ink-3">{it.hint}</span>}
              </div>
            </li>
          ))}
          {!items.length && <li className="px-3 py-8 text-center text-[13px] text-ink-2">Nada encontrado para “{q}”. Tente o número da REF ou um @.</li>}
        </ul>
        <div className="num hidden items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-ink-3 sm:flex">
          <span><kbd>↑</kbd> <kbd>↓</kbd> navegar</span><span><kbd>↵</kbd> abrir</span><span><kbd>?</kbd> atalhos</span>
          <span className="ml-auto inline-flex items-center gap-1"><Hash size={11} aria-hidden />0163 abre a REF</span>
          <span className="inline-flex items-center gap-1"><Users size={11} aria-hidden />nome do expert</span>
        </div>
      </div>
    </div>
  );
}
