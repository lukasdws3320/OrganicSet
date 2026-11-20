import type { Stage } from "../../../server/types";
import { STAGES, STAGE_LABEL } from "../../../server/types";
import { fmtInt } from "../lib";
import { StageBadge } from "./StageBadge";

/**
 * Barra do ciclo (SPEC §5.2).
 * - `stage`: 7 segmentos de 4px; os já percorridos em tinta, o atual em Brasa, rótulos "Guardada … Postada".
 * - `counts`: barra segmentada proporcional por estágio (Hoje › Produção por perfil), com legenda numérica.
 *   A legenda repete glifo + texto: a barra nunca depende só de cor.
 */
export function LifecycleBar(props:
  | { stage: Stage; sub?: string; className?: string; counts?: undefined; order?: undefined; legend?: undefined }
  | { counts: Partial<Record<Stage, number>>; order?: Stage[]; legend?: boolean; className?: string; stage?: undefined; sub?: undefined }) {
  if (props.counts) {
    const order = props.order ?? STAGES;
    const items = order.map((s) => ({ s, n: props.counts![s] ?? 0 })).filter((x) => x.n > 0);
    const total = items.reduce((a, x) => a + x.n, 0);
    const desc = items.map((x) => `${x.n} ${STAGE_LABEL[x.s].toLowerCase()}`).join(", ");
    return (
      <div className={["lc lc--n", props.className].filter(Boolean).join(" ")}>
        <div className="lc-bar" role="img" aria-label={total ? desc : "Nada no ciclo"}>
          {total ? items.map((x) => <i key={x.s} data-s={x.s} style={{ ["--w" as string]: x.n }} title={`${STAGE_LABEL[x.s]}: ${fmtInt(x.n)}`} />) : <i />}
        </div>
        {props.legend !== false && total > 0 && (
          <ul className="lc-leg">
            {items.map((x) => (
              <li key={x.s}><StageBadge stage={x.s} label={STAGE_LABEL[x.s]} /><span className="n">{fmtInt(x.n)}</span></li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const k = STAGES.indexOf(props.stage);
  return (
    <div className={["lc", props.className].filter(Boolean).join(" ")}>
      <div className="lc-bar" role="img" aria-label={`Ciclo: ${STAGE_LABEL[props.stage]}${props.sub ? ` · ${props.sub}` : ""} (estágio ${k + 1} de ${STAGES.length})`}>
        {STAGES.map((s, i) => <i key={s} className={i < k ? "on" : i === k ? "cur" : undefined} />)}
      </div>
      <div className="lc-ends" aria-hidden>
        {/* Rótulo da ponta some quando é o próprio estágio atual (nada de "Postada … Postada"). */}
        <span>{k > 0 ? STAGE_LABEL[STAGES[0]] : ""}</span>
        <b>{STAGE_LABEL[props.stage]}{props.sub ? ` · ${props.sub}` : ""}</b>
        <span>{k < STAGES.length - 1 ? STAGE_LABEL[STAGES[STAGES.length - 1]] : ""}</span>
      </div>
    </div>
  );
}
