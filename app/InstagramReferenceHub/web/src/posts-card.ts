import type { PostItem } from "../../server/posts";
import type { PostData } from "./components/InstagramPost";
import { fmtDateTime } from "./lib";
import { refShort } from "./refs";

/** Post (seção do Postagens.md) → card. Vídeo, carrossel ou vídeo próprio do expert: a mesma lista do calendário e do painel. */
export function postCard(p: PostItem): PostData {
  const extra = [p.versao && p.tipo === "video" ? p.versao : null, p.canal, p.legenda_fonte === "referencia" ? "legenda da referência, falta adaptar" : null].filter(Boolean).join(" · ");
  return {
    id: p.id,
    chave: { ref: p.ref, hub_slug: p.personagem },
    perfil: { nome: p.personagem_nome ?? p.perfil.name, handle: p.perfil.handle },
    formato: p.tipo === "carrossel" ? "carrossel" : "reel",
    proporcao: p.tipo === "carrossel" ? "3/4" : "9/16",
    titulo: p.titulo,
    slides: p.tipo === "carrossel" ? p.slides.map((src, i) => ({ n: i + 1, src })) : undefined,
    total_previsto: p.tipo === "carrossel" ? p.slides.length : undefined,
    midia_video: p.video ? { src: p.video } : null,
    capa: p.capa,
    legenda: p.legenda,
    status: p.stage === "arquivada" ? "pronta" : p.stage,
    sub: p.agendado_para && p.stage !== "postada" ? fmtDateTime(p.agendado_para).slice(0, 5) + (p.hora ? " " + p.hora : "") : null,
    atrasada: p.late,
    contexto: `${p.ref ? refShort(p.ref) : p.tipo === "carrossel" ? "Carrossel" : "Vídeo"}${extra ? ` · ${extra}` : ""}`,
    hub_url: p.hub_url,
  };
}

