import { AlertTriangle, Bookmark, ChevronLeft, ChevronRight, Copy, Heart, MessageCircle, Play, Send } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { copy, fmtDuration } from "../lib";
import { Button, Segmented } from "../ui";
import { StageBadge, type BadgeState } from "./StageBadge";

/**
 * Contrato `Post` (SPEC §8; espelho de ClientesRoadmap/design/post.py). O Hub, o painel privado e o
 * dashboard renderizam o mesmo objeto; aqui é o renderizador React (setas com scrollTo, slide atual por
 * IntersectionObserver, ←/→, copiar legenda, comparar Original | Recriação).
 */
export type SlideEstado = "pronto" | "pendente" | "gerando" | "erro";
export interface PostSlide {
  n: number;
  estado?: SlideEstado;
  src?: string | null;
  w?: number | null;
  h?: number | null;
  alt?: string;
  /** Slide equivalente da referência (terceiro). Só Hub/privado; nunca vai para o dashboard. */
  ref_original?: string | null;
}
export interface PostVideo { src?: string | null; poster?: string | null; w?: number | null; h?: number | null; duracao_s?: number | null }
export interface PostData {
  id: string;
  chave?: { ref?: string | null; hub_slug?: string | null };
  perfil?: { handle?: string | null; nome?: string | null; avatar?: string | null };
  formato: "carrossel" | "reel" | "imagem";
  /** Medida ("3/4", "9/16", "1/1"). Nunca 4:5 por padrão. */
  proporcao?: string | null;
  titulo?: string;
  /** Sempre `total_previsto` itens, pendentes inclusive. */
  slides?: PostSlide[];
  total_previsto?: number;
  midia_video?: PostVideo | null;
  capa?: string | null;
  legenda?: { texto?: string | null; fonte?: string | null } | string | null;
  status?: BadgeState;
  sub?: string | null;
  atrasada?: boolean | string;
  divergente?: boolean | string;
  /** Linha mono sob o @ ("IA 2 · hoje 17:30"). */
  contexto?: string | null;
  avisos?: string[];
  hub_url?: string | null;
  /** Identidade (logo, foto do expert): `contain` em vez de `cover`. */
  contain?: boolean;
}

const pendente = (s: PostSlide) => !s.src || (s.estado != null && s.estado !== "pronto");
const PEND_LABEL: Record<SlideEstado, string> = { pronto: "pronto", pendente: "pendente", gerando: "gerando", erro: "erro na geração" };

export function InstagramPost({ post, actions, original, compact, initialView = "rec", onSlideChange, className, footNote }: {
  post: PostData;
  /** Ações à direita do rodapé (primário do momento + secundários). */
  actions?: ReactNode;
  /** Mídia da referência para o comparar; se ausente, usa `slides[].ref_original` quando houver. */
  original?: { slides?: PostSlide[]; video?: PostVideo | null; proporcao?: string | null } | null;
  compact?: boolean;
  initialView?: "rec" | "ori";
  onSlideChange?: (index: number) => void;
  className?: string;
  /** Texto extra no rodapé mono (ex.: "1080×1440"). */
  footNote?: ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  const domId = `ig-${post.id.replace(/[^\w-]/g, "")}-${uid}`;
  const reel = post.formato === "reel";

  const recSlides = slidesOf(post);
  const oriSlides: PostSlide[] = original?.slides?.length
    ? original.slides
    : recSlides.some((s) => s.ref_original)
      ? recSlides.map((s) => ({ n: s.n, src: s.ref_original ?? null, estado: s.ref_original ? "pronto" : "pendente" }))
      : [];
  const canCompare = oriSlides.length > 0 || !!original?.video?.src;
  const [view, setView] = useState<"rec" | "ori">(canCompare ? initialView : "rec");
  const showing = view === "ori" && canCompare ? "ori" : "rec";
  const slides = showing === "ori" ? (oriSlides.length ? oriSlides : recSlides) : recSlides;
  const video = showing === "ori" ? original?.video ?? null : post.midia_video ?? null;
  const ar = (showing === "ori" && original?.proporcao) || post.proporcao || (reel ? "9/16" : "3/4");
  const total = reel ? 1 : slides.length;

  const trackRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState(0);

  // Slide atual = o que ocupa ≥60% do trilho (IntersectionObserver com o próprio trilho como raiz).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || total < 2) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setCur(Number((e.target as HTMLElement).dataset.i));
    }, { root: track, threshold: 0.6 });
    track.querySelectorAll(".ig-slide").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [total, showing]);
  useEffect(() => { onSlideChange?.(cur); }, [cur, onSlideChange]);

  // Ao trocar Original/Recriação, manter o mesmo índice.
  useEffect(() => {
    const t = trackRef.current;
    if (t) t.scrollTo({ left: Math.min(cur, total - 1) * t.clientWidth, behavior: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing]);

  const go = useCallback((i: number) => {
    const t = trackRef.current;
    if (!t) return;
    const k = Math.max(0, Math.min(total - 1, i));
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    // scrollTo no trilho: só o eixo X do carrossel anda; a página (window.scrollY) não salta.
    t.scrollTo({ left: k * t.clientWidth, behavior: smooth ? "smooth" : "auto" });
    setCur(k);
  }, [total]);

  const onKey = (e: KeyboardEvent) => {
    if (total < 2 || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "VIDEO" || tag === "INPUT") return;
    e.preventDefault();
    go(cur + (e.key === "ArrowRight" ? 1 : -1));
  };

  const legenda = typeof post.legenda === "string" ? post.legenda : post.legenda?.texto ?? "";
  const handle = (post.perfil?.handle ?? "").replace(/^@/, "");
  const pend = slides.filter(pendente).length;
  const ref = post.chave?.ref;

  return (
    <article
      id={domId}
      className={["ig", reel && "ig--reel", post.contain && "ig--contain", compact && "ig--compact", className].filter(Boolean).join(" ")}
      style={{ "--ig-ar": ar } as CSSProperties}
      aria-label={post.titulo ? `Post: ${post.titulo}` : undefined}
    >
      <header className="ig-head">
        <span className="ig-av" aria-hidden>
          {post.perfil?.avatar ? <img src={post.perfil.avatar} alt="" /> : (handle || post.perfil?.nome || "?").charAt(0).toUpperCase()}
        </span>
        <span className="ig-who">
          <b>{handle ? `@${handle}` : post.perfil?.nome ?? "sem @"}</b>
          {(post.contexto || post.titulo) && <span>{post.contexto ?? post.titulo}</span>}
        </span>
        {post.status && <StageBadge stage={post.status} sub={post.sub ?? undefined} late={post.atrasada} divergent={post.divergente} />}
      </header>

      {canCompare && (
        <div className="ig-cmp--hub">
          <Segmented label="Mostrar" size="sm" value={showing} onChange={setView}
            options={[{ value: "ori", label: "Original" }, { value: "rec", label: "Recriação" }]} />
          {showing === "ori" && <span className="rot">referência · só no privado</span>}
        </div>
      )}

      <div className="ig-stage" onKeyDown={onKey}>
        <div
          ref={trackRef}
          className="ig-track"
          tabIndex={0}
          role="group"
          aria-roledescription="carrossel"
          aria-label={reel ? "Reel" : `Post com ${total} slides${pend ? `, ${pend} pendentes` : ""}`}
        >
          {reel ? (
            <figure className="ig-slide" data-i={0}>
              <ReelMedia video={video} capa={post.capa} titulo={post.titulo} />
            </figure>
          ) : (
            slides.map((s, i) => (
              <figure key={`${showing}-${s.n}-${i}`} className={["ig-slide", pendente(s) && "is-pending"].filter(Boolean).join(" ")} data-i={i}
                aria-roledescription="slide" aria-label={`Slide ${i + 1} de ${total}${pendente(s) ? ` · ${PEND_LABEL[s.estado ?? "pendente"]}` : ""}`}>
                {pendente(s) ? (
                  <div className="ig-pend"><strong>{s.n}</strong>slide {s.n} · {PEND_LABEL[s.estado && s.estado !== "pronto" ? s.estado : "pendente"]}</div>
                ) : (
                  <img src={s.src!} alt={s.alt ?? `Slide ${i + 1} de ${total}`} width={s.w ?? undefined} height={s.h ?? undefined} loading={i < 2 ? "eager" : "lazy"} decoding="async" draggable={false} />
                )}
                {total > 1 && <span className="ig-count">{i + 1}/{total}</span>}
                {total > 1 && total <= 20 && (
                  <span className="ig-dots" aria-hidden="true">
                    {slides.map((d, j) => <i key={j} className={j === i ? "on" : pendente(d) ? "miss" : undefined} />)}
                  </span>
                )}
              </figure>
            ))
          )}
        </div>
        {total > 1 && (
          <>
            <button type="button" className="ig-nav ig-prev" data-finder-ignore="" aria-label="Slide anterior" aria-controls={domId} hidden={cur === 0} onClick={() => go(cur - 1)}>
              <ChevronLeft strokeWidth={2} size={16} />
            </button>
            <button type="button" className="ig-nav ig-next" data-finder-ignore="" aria-label="Próximo slide" aria-controls={domId} hidden={cur >= total - 1} onClick={() => go(cur + 1)}>
              <ChevronRight strokeWidth={2} size={16} />
            </button>
            <span className="sr" aria-live="polite">Slide {cur + 1} de {total}</span>
          </>
        )}
      </div>

      {!compact && (
        <div className="ig-actions" aria-hidden="true">
          <Heart size={20} strokeWidth={1.6} /><MessageCircle size={20} strokeWidth={1.6} /><Send size={20} strokeWidth={1.6} />
          <Bookmark size={20} strokeWidth={1.6} className="sp" />
        </div>
      )}

      <Caption id={domId} handle={handle} text={legenda} />

      {post.avisos?.map((a, i) => (
        <p key={i} className="ig-warn" role="note"><AlertTriangle aria-hidden />{a}</p>
      ))}

      <footer className="ig-foot">
        <span className="mono">
          {ref && (post.hub_url ? <a href={post.hub_url}>{ref}↗</a> : ref)}
          {ref && " · "}
          {ar.replace("/", ":")}
          {!reel && total > 1 && <> · <span className="tabular-nums">{cur + 1} de {total}</span></>}
          {pend > 0 && !reel && <> · {pend} pendente{pend > 1 ? "s" : ""}</>}
          {footNote && <> · {footNote}</>}
        </span>
        <span className="sp" />
        {legenda && (
          <Button size="sm" variant="secondary" icon={<Copy />} onClick={() => copy(legenda, "Legenda copiada")}>Copiar legenda</Button>
        )}
        {actions}
      </footer>
    </article>
  );
}

function ReelMedia({ video, capa, titulo }: { video: PostVideo | null; capa?: string | null; titulo?: string }) {
  if (video?.src) {
    // Sem poster próprio, o quadro inicial é o do próprio vídeo (#t=0.1 + metadata) — nunca a capa da referência.
    if (video.poster) return <video src={video.src} poster={video.poster} controls preload="none" playsInline />;
    return <video src={`${video.src}#t=0.1`} controls preload="metadata" playsInline />;
  }
  const poster = video?.poster ?? capa;
  return (
    <>
      {poster
        ? <img src={poster} alt={titulo ? `Capa: ${titulo}` : "Capa do reel"} loading="lazy" decoding="async" />
        : <div className="ig-poster-ph"><div><strong>{titulo ?? "Reel"}</strong>sem vídeo editado ainda</div></div>}
      <span className="ig-play" aria-hidden><span><Play /></span></span>
      {video?.duracao_s != null && <span className="ig-dur">{fmtDuration(video.duracao_s)}</span>}
    </>
  );
}

function Caption({ id, handle, text }: { id: string; handle: string; text: string }) {
  const tid = `${id}-cap`;
  if (!text) return <div className="ig-cap"><p className="ig-cap-txt ig-cap-vazia">Sem legenda ainda.</p></div>;
  const long = text.length > 90 || text.includes("\n");
  return (
    <div className="ig-cap">
      {long && <input type="checkbox" id={tid} className="ig-more-t" />}
      {/* Fechada: prévia sem linhas em branco (como no Instagram); aberta: a legenda com a formatação original. */}
      {long && <p className="ig-cap-txt ig-cap-prev">{handle && <b>{handle} </b>}{text.replace(/\n\s*\n+/g, "\n").trim()}</p>}
      <p className={long ? "ig-cap-txt ig-cap-full" : "ig-cap-txt"}>{handle && <b>{handle} </b>}{text.trim()}</p>
      {long && <label htmlFor={tid} className="ig-more">mais</label>}
    </div>
  );
}

function slidesOf(post: PostData): PostSlide[] {
  const list = [...(post.slides ?? [])].sort((a, b) => a.n - b.n);
  const total = Math.max(post.total_previsto ?? 0, list.length, list.at(-1)?.n ?? 0);
  if (post.formato === "reel") return list;
  if (!total) return post.capa ? [{ n: 1, src: post.capa, estado: "pronto" }] : [{ n: 1, estado: "pendente" }];
  // Buracos explícitos: um carrossel parcial nunca parece completo.
  const byN = new Map(list.map((s) => [s.n, s]));
  return Array.from({ length: total }, (_, i) => byN.get(i + 1) ?? { n: i + 1, estado: "pendente" as const });
}
