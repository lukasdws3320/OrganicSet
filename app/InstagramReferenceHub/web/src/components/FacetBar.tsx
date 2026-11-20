import { useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { isTyping } from "../lib";
import { Button, Chip, Facet, Segmented, type FacetOption } from "../ui";

export interface FacetDef<T extends string | number = string | number> {
  key: string;
  label: string;
  options: FacetOption<T>[];
  value: T[];
  onChange: (v: T[]) => void;
  multiple?: boolean;
  /** Contagem total mostrada no botão inativo. */
  n?: number | null;
}

/**
 * Barra de facetas (SPEC §4.2 / §5.2 Biblioteca): `.seg` Tipo + `.facet` por eixo + atalhos
 * (ex.: "Sem criador 114", borda tracejada) + ordenação à direita; abaixo, os filtros ativos como chips
 * "Eixo valor ×" e "Limpar". Backspace (com foco na barra) remove o último filtro.
 * Facetas sem valores não aparecem. No mobile a linha rola na horizontal.
 */
export function FacetBar<K extends string>({ segment, facets, shortcuts = [], end, onClear, label = "Filtros" }: {
  segment?: { label: string; value: K; onChange: (v: K) => void; options: { value: K; label: ReactNode; n?: number | null; icon?: ReactNode }[] };
  facets: FacetDef<any>[];
  shortcuts?: { key: string; label: string; n?: number | null; active: boolean; onToggle: () => void }[];
  end?: ReactNode;
  onClear?: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chips: { key: string; axis: string; text: ReactNode; remove: () => void }[] = [];
  for (const f of facets) {
    for (const v of f.value) {
      const o = f.options.find((x) => x.value === v);
      chips.push({ key: `${f.key}:${v}`, axis: f.label, text: o?.label ?? String(v), remove: () => f.onChange(f.value.filter((x) => x !== v)) });
    }
  }
  for (const s of shortcuts) if (s.active) chips.push({ key: `atalho:${s.key}`, axis: "", text: s.label, remove: s.onToggle });

  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "Backspace" || isTyping(e.nativeEvent) || !chips.length) return;
    e.preventDefault();
    chips.at(-1)!.remove();
  };

  return (
    <div ref={ref} className="fbar" role="group" aria-label={label} onKeyDown={onKey}>
      <div className="fbar-row">
        {segment && <Segmented label={segment.label} value={segment.value} onChange={segment.onChange} options={segment.options} />}
        {facets.map((f) => (
          <Facet key={f.key} label={f.label} options={f.options} value={f.value} onChange={f.onChange} multiple={f.multiple} n={f.n} />
        ))}
        {shortcuts.map((s) => (
          <button key={s.key} type="button" className={["facet", "facet--atalho", s.active && "on"].filter(Boolean).join(" ")} aria-pressed={s.active} onClick={s.onToggle}>
            {s.label}{s.n != null && <span className="n">{s.n}</span>}
          </button>
        ))}
        {end && <span className="sp">{end}</span>}
      </div>
      {chips.length > 0 && (
        <div className="fbar-chips" aria-label="Filtros ativos">
          {chips.map((c) => <Chip key={c.key} axis={c.axis || undefined} onRemove={c.remove}>{c.text}</Chip>)}
          {onClear && <Button variant="ghost" size="sm" onClick={onClear}>Limpar</Button>}
        </div>
      )}
    </div>
  );
}
