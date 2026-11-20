import { AlertTriangle, Check, ChevronDown, MoreHorizontal, X } from "lucide-react";
import {
  Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type AnchorHTMLAttributes, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode,
} from "react";
import type { Metrics, Status } from "../../server/types";
import { STATUS_LABEL } from "../../server/types";
import { StageBadge } from "./components/StageBadge";
import { ago, dismissToast, fmtDateTime, fmtInt, toasts, useStore, type ToastItem } from "./lib";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ---------- botões (SPEC §4.1: um componente, 6 variantes) ----------

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "icon" | "danger";
export type ButtonSize = "sm" | "md";

/** Classes do `.btn` para quem precisa aplicar o visual a outro elemento (ex.: <a>, <label>). */
export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  return cx("btn", `btn--${variant}`, size === "sm" && "btn--sm", extra);
}

type ButtonOwnProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ícone lucide (16px) à esquerda do rótulo. */
  icon?: ReactNode;
  /** Atalho mostrado em <kbd> à direita ("⌘I"). */
  kbd?: string;
  /** Ação em andamento: aria-busy, rótulo `busyLabel`, largura travada, clique ignorado. */
  busy?: boolean;
  busyLabel?: ReactNode;
  /** Desabilita mantendo o foco e explica o motivo (title + aria-disabled). */
  disabledReason?: string;
};

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & ButtonOwnProps;

function Label({ children, busy, busyLabel }: { children: ReactNode; busy?: boolean; busyLabel?: ReactNode }) {
  if (busy === undefined) return children == null || children === false ? null : <span>{children}</span>;
  // Os dois rótulos dividem a mesma célula da grade: a largura é a do maior e não muda com o estado.
  return (
    <span className="btn-l">
      <span className="btn-idle" aria-hidden={busy || undefined}>{children}</span>
      <span className="btn-busy" aria-hidden={!busy || undefined}>{busyLabel ?? "Salvando…"}</span>
    </span>
  );
}

export function Button({
  variant = "secondary", size = "md", icon, kbd, busy, busyLabel, disabledReason, className, children, onClick, type, title, ...p
}: BtnProps) {
  const blocked = !!disabledReason || !!busy;
  return (
    <button
      {...p}
      type={type ?? "button"}
      title={disabledReason ?? title}
      aria-disabled={disabledReason ? true : p["aria-disabled"]}
      aria-busy={busy || undefined}
      onClick={(e) => { if (blocked) { e.preventDefault(); return; } onClick?.(e); }}
      className={buttonClass(variant, size, className)}
    >
      {icon}
      <Label busy={busy} busyLabel={busyLabel}>{children}</Label>
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}

/** <a> com visual de botão (navegação real, abre em nova aba quando `external`). */
export function ButtonLink({ variant = "secondary", size = "md", icon, kbd, className, children, external, ...p }:
  AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode; kbd?: string; external?: boolean }) {
  return (
    <a {...p} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className={buttonClass(variant, size, className)}>
      {icon}
      {children != null && <span>{children}</span>}
      {kbd && <kbd>{kbd}</kbd>}
    </a>
  );
}

/** Botão só com ícone: aria-label obrigatório; o tooltip mostra o atalho. */
export function IconButton({ label, active, kbd, size = "md", variant = "ghost", className, children, type, ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; kbd?: string; size?: ButtonSize; variant?: "ghost" | "secondary" | "primary" | "danger" }) {
  return (
    <button
      {...p}
      type={type ?? "button"}
      aria-label={label}
      title={kbd ? `${label} (${kbd})` : label}
      aria-pressed={active}
      className={cx("btn btn--icon", `btn--${variant}`, size === "sm" && "btn--sm", className)}
    >
      {children}
    </button>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

// ---------- filtros: chip, segmented, faceta (SPEC §4.2) ----------

/** Chip: filtro ativo ("Eixo valor ×"), valor removível ou alternável (`onClick` + `active`). */
export function Chip({ children, axis, color, onRemove, active, onClick, className }: {
  children: ReactNode; axis?: ReactNode; color?: string; onRemove?: () => void; active?: boolean; onClick?: () => void; className?: string;
}) {
  const body = (
    <>
      {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />}
      {axis && <span className="eixo">{axis}</span>}
      <span className="truncate">{children}</span>
    </>
  );
  if (onClick) {
    return (
      <span className={cx("chip chip--toggle", className)}>
        <button type="button" className="chip-b" aria-pressed={active} onClick={onClick}>{body}</button>
        {onRemove && <RemoveX onRemove={onRemove} label={typeof children === "string" ? children : undefined} />}
      </span>
    );
  }
  return (
    <span className={cx("chip", !onRemove && "chip--static", className)}>
      {body}
      {onRemove && <RemoveX onRemove={onRemove} label={typeof children === "string" ? children : undefined} />}
    </span>
  );
}
function RemoveX({ onRemove, label }: { onRemove: () => void; label?: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label={label ? `Remover ${label}` : "Remover"}>
      <X size={12} strokeWidth={1.75} />
    </button>
  );
}

/** Eixo exclusivo curto (SPEC §4.2 `.seg`), com contagem mono opcional. ←/→ trocam a opção. */
export function Segmented<T extends string>({ options, value, onChange, size = "md", label, className }: {
  options: { value: T; label: ReactNode; n?: number | null; icon?: ReactNode }[]; value: T; onChange: (v: T) => void; size?: "sm" | "md"; label: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length];
    onChange(next.value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKey} className={cx("seg", size === "sm" && "seg--sm", className)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={cx(on && "on")} onClick={() => onChange(o.value)}>
            {o.icon}
            {o.label}
            {o.n != null && <span className="n">{fmtInt(o.n)}</span>}
          </button>
        );
      })}
    </div>
  );
}

export type FacetOption<T extends string | number = string | number> = { value: T; label: ReactNode; n?: number | null; text?: string };

/** Faceta: botão 30px (rótulo + contagem + chevron) que abre a lista com busca e contagem por valor.
 *  Ativa = invertida com ✕. Sem valores = não renderiza (SPEC §4.2). */
export function Facet<T extends string | number>({ label, options, value, onChange, multiple = true, n, searchable, width = 280, align = "start" }: {
  label: string; options: FacetOption<T>[]; value: T[]; onChange: (v: T[]) => void; multiple?: boolean; n?: number | null; searchable?: boolean; width?: number; align?: "start" | "end";
}) {
  const [q, setQ] = useState("");
  if (!options.length) return null;
  const active = value.length > 0;
  const shown = active
    ? value.length === 1 ? textOf(options.find((o) => o.value === value[0])) ?? label : `${label} · ${value.length}`
    : label;
  const search = searchable ?? options.length > 8;
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const list = q ? options.filter((o) => norm(textOf(o) ?? "").includes(norm(q))) : options;
  return (
    <Popover
      align={align}
      width={width}
      trigger={({ open, toggle }) => active ? (
        <span className="facet on facet--split">
          <button type="button" className="facet-b" aria-expanded={open} aria-haspopup="listbox" onClick={toggle} aria-label={`${label}: ${shown}`}>
            <span className="max-w-[160px] truncate">{shown}</span>
          </button>
          <button type="button" className="facet-x" aria-label={`Limpar ${label}`} onClick={() => onChange([])}><X strokeWidth={1.75} /></button>
        </span>
      ) : (
        <button type="button" className="facet" aria-expanded={open} aria-haspopup="listbox" onClick={toggle}>
          <span className="max-w-[160px] truncate">{label}</span>
          {n != null && <span className="n">{fmtInt(n)}</span>}
          <ChevronDown strokeWidth={1.75} />
        </button>
      )}
    >
      {(close) => (
        <div>
          {search && <input autoFocus className="pop-search" placeholder={`Buscar ${label.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Buscar em ${label}`} />}
          <ul className="pop-list" role="listbox" aria-multiselectable={multiple} aria-label={label}>
            {list.map((o) => {
              const on = value.includes(o.value);
              return (
                <li key={String(o.value)}>
                  <button type="button" role="option" aria-selected={on} className="pop-opt"
                    onClick={() => {
                      if (multiple) onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
                      else { onChange(on ? [] : [o.value]); close(); }
                    }}>
                    <span className="bx" aria-hidden>{on && <Check strokeWidth={2.5} />}</span>
                    <span className="lb">{o.label}</span>
                    {o.n != null && <span className="n">{fmtInt(o.n)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          {!list.length && <p className="pop-empty">Nenhum valor com “{q}”.</p>}
        </div>
      )}
    </Popover>
  );
}
function textOf(o?: { label: ReactNode; text?: string }) {
  if (!o) return undefined;
  if (o.text) return o.text;
  if (typeof o.label === "string" || typeof o.label === "number") return String(o.label);
  const parts: string[] = [];
  const walk = (n: ReactNode) => Children.forEach(n, (c) => {
    if (typeof c === "string" || typeof c === "number") parts.push(String(c));
    else if (isValidElement<{ children?: ReactNode }>(c)) walk(c.props.children);
  });
  walk(o.label);
  return parts.join("");
}

/** Status antigo (refs.status): derivado desde a migração 11. Mantido até H5 trocar por StageBadge. */
export function StatusTag({ status, quiet }: { status: Status; quiet?: boolean }) {
  if (quiet && status === "disponivel") return null;
  const s = status === "usada" ? "postada" : status === "producao" ? "producao" : "guardada";
  return <StageBadge stage={s} label={STATUS_LABEL[status]} chip />;
}

export function Avatar({ name, size = 40 }: { name: string | null; size?: number }) {
  const letter = (name ?? "?").replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <span className="grid shrink-0 place-items-center rounded-full border border-line bg-sunken font-display italic text-ink-2" style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden>
      {letter}
    </span>
  );
}

// ---------- cabeçalho de página (Hub: título 26, SPEC §2) ----------

export function PageHeader({ title, meta, actions, children }: { title: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4">
      <div className="min-w-0">
        <h1 className="title-serif text-[26px] sm:text-[34px]">{title}</h1>
        {meta && <div className="num mt-1.5 text-[12px] text-ink-3">{meta}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

// ---------- popover / modal ----------

export function Popover({ trigger, children, align = "start", width = 280, className }: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode; children: (close: () => void) => ReactNode; align?: "start" | "end"; width?: number; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // Painel estreito (viewer lateral): o menu não pode sair da tela. Empurra para dentro antes de pintar.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!open || !el) return;
    el.style.translate = "";
    const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, m = 8;
    const dx = r.right > vw - m ? vw - m - r.right : r.left < m ? m - r.left : 0;
    if (dx) el.style.translate = `${Math.round(dx)}px 0`;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); setOpen(false);
      ref.current?.querySelector<HTMLElement>("[aria-expanded], button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);
  return (
    <div ref={ref} className={cx("relative", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div ref={popRef} className={cx("pop fade-in", align === "end" ? "pop--end" : "pop--start")} style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Diálogo modal: foco preso, Esc fecha, foco volta para quem abriu. Substitui window.prompt/confirm. */
export function Modal({ title, onClose, children, footer, width = 520 }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = dialogRef.current;
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    // Primeiro campo/ação do corpo; o "Fechar" só se não houver outro.
    const all = focusable();
    (all.find((el) => !el.dataset.modalClose) ?? all[0] ?? root)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === "Tab") {
        const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
        if (!first) { e.preventDefault(); root?.focus(); }
        else if (e.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return (
    <div ref={dialogRef} tabIndex={-1} className="modal" role="dialog" aria-modal aria-labelledby={id}>
      <div className="modal-scrim fade-in" onClick={onClose} />
      <div className="modal-box fade-in" style={{ maxWidth: width }}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <IconButton label="Fechar" kbd="Esc" onClick={onClose} data-modal-close="1"><X size={18} strokeWidth={1.5} /></IconButton>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Lista de opções marcáveis (usada nos filtros e nas relações). */
export function CheckList<T extends string | number>({ options, value, onChange, empty = "Nada para escolher ainda." }: {
  options: { value: T; label: ReactNode; color?: string; hint?: ReactNode }[]; value: T[]; onChange: (v: T[]) => void; empty?: ReactNode;
}) {
  if (!options.length) return <p className="pop-empty">{empty}</p>;
  return (
    <ul className="pop-list">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <li key={String(o.value)}>
            <button type="button" onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])} className="pop-opt" aria-checked={on} role="checkbox">
              <span className="bx" aria-hidden>{on && <Check strokeWidth={2.5} />}</span>
              {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} aria-hidden />}
              <span className="lb">{o.label}</span>
              {o.hint != null && <span className="n">{o.hint}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Menu ⋯ de ações secundárias (`.btn--icon`). */
export function MoreMenu({ label = "Mais ações", items, align = "end" }: {
  label?: string; items: { label: ReactNode; onSelect: () => void; danger?: boolean; disabledReason?: string }[]; align?: "start" | "end";
}) {
  return (
    <Popover align={align} width={240} trigger={({ open, toggle }) => (
      <IconButton label={label} aria-expanded={open} aria-haspopup="menu" onClick={toggle}><MoreHorizontal size={18} strokeWidth={1.5} /></IconButton>
    )}>
      {(close) => (
        <ul className="pop-list" role="menu">
          {items.map((it, i) => (
            <li key={i} role="none">
              <button type="button" role="menuitem" className={cx("pop-opt", it.danger && "text-late")} aria-disabled={it.disabledReason ? true : undefined} title={it.disabledReason}
                onClick={() => { if (it.disabledReason) return; close(); it.onSelect(); }}>
                <span className="lb">{it.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

// ---------- estados vazios (SPEC §4.12: a frase do que falta + uma ação) ----------

export function Empty({ title, children, action }: { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-r3 border border-dashed border-line-2 px-6 py-10 text-center sm:py-14">
      <div className="mx-auto max-w-md">
        <h2 className="title-serif text-[22px] sm:text-[26px]">{title}</h2>
        {children && <div className="mt-2 text-[14px] text-ink-2">{children}</div>}
        {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

/** Erro com código e corpo reais + "Tentar de novo". Hub desligado ≠ 4xx. */
export function ErrorState({ title, detail, onRetry }: { title: ReactNode; detail?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="estado estado--erro" role="alert">
      <AlertTriangle aria-hidden />
      <div className="corpo"><b>{title}</b>{detail && <p className="mono">{detail}</p>}</div>
      {onRetry && <div className="acoes"><Button size="sm" onClick={onRetry}>Tentar de novo</Button></div>}
    </div>
  );
}

/** Esqueleto listrado na proporção final (sem spinner de página). */
export function Skeleton({ ratio = "9/16", className }: { ratio?: string; className?: string }) {
  return <div className={cx("esq", className)} style={{ aspectRatio: ratio }} aria-hidden />;
}

// ---------- métricas ----------

/** Linha de data de coleta: nunca apresenta número antigo como atual. */
export function CollectedAt({ m, className }: { m: Metrics | null; className?: string }) {
  if (!m) return <span className={cx("num text-xs text-ink-3", className)}>Métricas não coletadas</span>;
  const a = ago(m.collected_at);
  return (
    <span className={cx("num text-xs text-ink-3", className)}>
      {m.source === "manual" ? "informado em" : "coletado em"} {fmtDateTime(m.collected_at)}
      {a !== "hoje" && <span className="text-warn"> · {a}</span>}
    </span>
  );
}

export function MetricValue({ value, label }: { value: number | null | undefined; label: string }) {
  return (
    <div className="min-w-0">
      <div className={cx("num truncate", value == null ? "text-[13px] leading-[28px] text-ink-3" : "text-[22px] leading-[28px]")}>
        {value == null ? "Não disponível" : fmtInt(value)}
      </div>
      <div className="eyebrow mt-0.5">{label}</div>
    </div>
  );
}

// ---------- toasts (com Desfazer) ----------

export function Toast({ t }: { t: ToastItem }) {
  return (
    <div className={cx("toast fade-in", t.tone === "erro" && "toast--erro")} role={t.tone === "erro" ? "alert" : "status"}>
      {t.tone === "erro" && <AlertTriangle aria-hidden />}
      <span className="toast-tx">{t.tone === "erro" && <span className="sr">Erro: </span>}{t.text}</span>
      {t.action && (
        <button type="button" className="toast-act" onClick={() => { dismissToast(t.id); t.action!.run(); }}>{t.action.label}</button>
      )}
    </div>
  );
}

export function Toaster() {
  const list = useStore(toasts);
  return (
    <div aria-live="polite" className="toasts">
      {list.map((t) => <Toast key={t.id} t={t} />)}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

/** Barra indeterminada fina (sem spinner girando). */
export function Working({ className }: { className?: string }) {
  return (
    <span className={cx("relative block h-px w-full overflow-hidden bg-line", className)} aria-hidden>
      <span className="absolute inset-y-0 left-0 w-1/3 bg-ink" style={{ animation: "progress-sweep 1.2s cubic-bezier(0.4,0,0.2,1) infinite" }} />
    </span>
  );
}

/** Memo de uso comum: opções de faceta a partir de {id,name,n}. */
export function useFacetOptions(values: { id: number; name: string; n: number }[] | undefined) {
  return useMemo(() => (values ?? []).map((v) => ({ value: v.id, label: v.name, n: v.n })), [values]);
}
