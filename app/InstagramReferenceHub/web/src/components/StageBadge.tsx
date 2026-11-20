import type { ReactNode } from "react";
import type { Stage } from "../../../server/types";
import { STAGE_LABEL } from "../../../server/types";

/** Ontologia única (SPEC §3.1): os 7 estágios do ciclo + 3 marcas (voce, atrasada, divergente). */
export type BadgeState = Stage | "voce" | "atrasada" | "divergente";

const LABEL: Record<BadgeState, string> = { ...STAGE_LABEL, voce: "Depende de mim", atrasada: "Atrasada", divergente: "Divergente" };

/** Glifos 10×10 (render 14px), iguais aos de ClientesRoadmap/design/componentes.py (GLIFOS). */
const GLYPH: Record<BadgeState, ReactNode> = {
  guardada: <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />,
  triada: <circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" />,
  atribuida: <><circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" /><circle cx="5" cy="5" r="1.5" fill="currentColor" /></>,
  producao: <><circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 1.1A3.9 3.9 0 0 1 5 8.9z" fill="currentColor" /></>,
  pronta: <circle cx="5" cy="5" r="4.4" fill="currentColor" />,
  agendada: <><circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 2.6V5l1.7 1.1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></>,
  postada: <><rect x=".6" y=".6" width="8.8" height="8.8" rx="2" fill="currentColor" /><path className="k" d="m2.6 5.2 1.6 1.6 3.2-3.4" fill="none" stroke="#141414" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></>,
  voce: <path d="M5 .6 9.4 5 5 9.4.6 5z" fill="currentColor" />,
  atrasada: <path d="M5 .8 9.4 9H.6z" fill="currentColor" />,
  divergente: <><circle cx="5" cy="5" r="3.9" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M5 2.7v2.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="5" cy="7.2" r=".7" fill="currentColor" /></>,
};

export function StageGlyph({ s }: { s: BadgeState }) {
  return <svg className="g" viewBox="0 0 10 10" width="14" height="14" aria-hidden="true" focusable="false">{GLYPH[s] ?? GLYPH.triada}</svg>;
}

export const stageLabel = (s: BadgeState) => LABEL[s] ?? s;

/**
 * StageBadge `.st[data-s]` (SPEC §4.3): glifo 14px + rótulo 12px. Status nunca só por cor.
 * - `sub`: sub-rótulo ("Edição 12/24", "27/10 17:30").
 * - `late` / `divergent`: modificadores; viram uma segunda marca ao lado (true = rótulo padrão, string = texto).
 * - `chip`: caixa com fundo quando o status está sozinho. postada/voce/atrasada sempre são chip (CSS).
 * - `href`: vira link (ex.: "Postada · ver ↗").
 */
export function StageBadge({ stage, label, sub, late, divergent, chip, href, title, className }: {
  stage: BadgeState; label?: ReactNode; sub?: ReactNode; late?: boolean | string; divergent?: boolean | string;
  chip?: boolean; href?: string; title?: string; className?: string;
}) {
  const main = <Badge s={stage} label={label ?? stageLabel(stage)} sub={sub} chip={chip} href={href} title={title} className={late || divergent ? undefined : className} />;
  if (!late && !divergent) return main;
  return (
    <span className={["sts", className].filter(Boolean).join(" ")}>
      {main}
      {late && <Badge s="atrasada" label={late === true ? LABEL.atrasada : late} />}
      {divergent && <Badge s="divergente" label={divergent === true ? LABEL.divergente : divergent} chip />}
    </span>
  );
}

function Badge({ s, label, sub, chip, href, title, className }: { s: BadgeState; label: ReactNode; sub?: ReactNode; chip?: boolean; href?: string; title?: string; className?: string }) {
  const cls = ["st", chip && "st--chip", className].filter(Boolean).join(" ");
  const body = (
    <>
      <StageGlyph s={s} />
      <span className="st-t">{label}</span>
      {sub != null && sub !== "" && <span className="st-sub">· {sub}</span>}
    </>
  );
  if (href) {
    const ext = /^https?:/.test(href);
    return <a className={cls} data-s={s} href={href} title={title} {...(ext ? { target: "_blank", rel: "noreferrer" } : {})}>{body}</a>;
  }
  return <span className={cls} data-s={s} title={title}>{body}</span>;
}
