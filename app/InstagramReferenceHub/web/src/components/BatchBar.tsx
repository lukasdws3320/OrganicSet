import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { fmtInt, isTyping } from "../lib";
import { Button, IconButton, Popover } from "../ui";

export interface BatchAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Ação direta. */
  onSelect?: () => void;
  /** Ou um Popover (Formato, Objetivo, Atribuir expert…). */
  popover?: (close: () => void) => ReactNode;
  /** Aparece no mobile; as demais vão para o ⋯. */
  mobile?: boolean;
  disabledReason?: string;
}

/**
 * Barra de lote (SPEC §4.5): flutua na base em `--night`. "N selecionadas · ações · [primária] · ✕".
 * A primária (Replicar) é `.btn--accent` e deve confirmar em Modal. Esc limpa a seleção.
 */
export function BatchBar({ count, actions, primary, onClear, noun = ["selecionada", "selecionadas"] }: {
  count: number; actions: BatchAction[]; primary?: { label: string; onSelect: () => void; busy?: boolean; disabledReason?: string; kbd?: string };
  onClear: () => void; noun?: [string, string];
}) {
  const [more, setMore] = useState<string | null>(null);
  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !isTyping(e) && !document.querySelector(".modal, .pop")) onClear(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, onClear]);
  if (!count) return null;
  const rest = actions.filter((a) => !a.mobile);
  return (
    <div className="batch fade-in" role="toolbar" aria-label="Ações em lote">
      <span className="batch-n" aria-live="polite"><span className="mono">{fmtInt(count)}</span> <span className="batch-w">{count === 1 ? noun[0] : noun[1]}</span></span>
      {actions.map((a) => (
        <span key={a.id} className={a.mobile ? undefined : "hide-m"}><Item a={a} /></span>
      ))}
      {rest.length > 0 && (
        <span className="batch-more">
          <Popover align="end" width={260} trigger={({ toggle, open }) => (
            <IconButton label="Mais ações em lote" aria-expanded={open} onClick={() => { setMore(null); toggle(); }} className="text-[#D8D3C9]"><MoreHorizontal size={18} strokeWidth={1.5} /></IconButton>
          )}>
            {(close) => {
              const sel = rest.find((a) => a.id === more);
              if (sel?.popover) return sel.popover(close);
              return (
                <ul className="pop-list" role="menu">
                  {rest.map((a) => (
                    <li key={a.id} role="none">
                      <button type="button" role="menuitem" className="pop-opt" aria-disabled={a.disabledReason ? true : undefined} title={a.disabledReason}
                        onClick={() => { if (a.disabledReason) return; if (a.popover) setMore(a.id); else { close(); a.onSelect?.(); } }}>
                        {a.icon}<span className="lb">{a.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              );
            }}
          </Popover>
        </span>
      )}
      {primary && (
        <Button variant="accent" size="sm" onClick={primary.onSelect} busy={primary.busy} busyLabel="Enviando…" disabledReason={primary.disabledReason} kbd={primary.kbd}>{primary.label}</Button>
      )}
      <IconButton label="Limpar seleção" kbd="Esc" onClick={onClear} className="text-[#D8D3C9]"><X size={16} strokeWidth={1.75} /></IconButton>
    </div>
  );
}

function Item({ a }: { a: BatchAction }) {
  if (a.popover) {
    return (
      <Popover width={280} trigger={({ toggle, open }) => (
        <Button variant="ghost" size="sm" icon={a.icon} aria-expanded={open} onClick={toggle} disabledReason={a.disabledReason}>{a.label}</Button>
      )}>
        {a.popover}
      </Popover>
    );
  }
  return <Button variant="ghost" size="sm" icon={a.icon} onClick={a.onSelect} disabledReason={a.disabledReason}>{a.label}</Button>;
}
