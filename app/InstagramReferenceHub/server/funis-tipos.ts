/**
 * Vocabulário dos funis (compartilhado entre servidor, interface e o painel privado via API).
 * Funil é DEMONSTRATIVO: desenha o caminho (post → comentário → DM → link → página → checkout),
 * não integra com Instagram, WhatsApp nem página nenhuma.
 * Cores dentro do Brand Atlas: sem verde (tokens.css).
 */

export const ETAPAS = [
  { tipo: "anuncio", label: "Anúncio", grupo: "Entrada", cor: "#A3431C" },
  { tipo: "post", label: "Post / Reel", grupo: "Entrada", cor: "#EE794E" },
  { tipo: "story", label: "Story", grupo: "Entrada", cor: "#C2577A" },
  { tipo: "comentario", label: "Comentário", grupo: "Conversa", cor: "#7A5AA6" },
  { tipo: "dm", label: "DM", grupo: "Conversa", cor: "#2E4A7A" },
  { tipo: "whatsapp", label: "WhatsApp / comercial", grupo: "Conversa", cor: "#3E6E8E" },
  { tipo: "bio", label: "Bio", grupo: "Perfil", cor: "#5B6B7A" },
  { tipo: "link", label: "Link de clique", grupo: "Perfil", cor: "#4A6FA5" },
  { tipo: "pagina", label: "Página", grupo: "Página", cor: "#8A5A00" },
  { tipo: "quiz", label: "Quiz", grupo: "Página", cor: "#B07A1E" },
  { tipo: "checkout", label: "Checkout", grupo: "Venda", cor: "#6B3E26" },
  { tipo: "upsell", label: "Upsell / downsell", grupo: "Venda", cor: "#9A5B3A" },
  { tipo: "obrigado", label: "Obrigado / entrega", grupo: "Venda", cor: "#6B665E" },
  { tipo: "nota", label: "Nota", grupo: "Outros", cor: "#9C968B" },
] as const;

export type TipoEtapa = (typeof ETAPAS)[number]["tipo"];
export const TIPOS_ETAPA = ETAPAS.map((e) => e.tipo) as TipoEtapa[];

/** Seções do swipe de funil. A pasta é o nome em disco dentro de library/funis/swipes/. */
export const SWIPES = [
  { tipo: "pagina", label: "Páginas", singular: "Página", pasta: "paginas" },
  { tipo: "quiz", label: "Quiz", singular: "Quiz", pasta: "quiz" },
  { tipo: "dm", label: "DMs", singular: "DM", pasta: "dms" },
  { tipo: "bio", label: "Bios", singular: "Bio", pasta: "bios" },
] as const;

export type TipoSwipe = (typeof SWIPES)[number]["tipo"];
export const TIPOS_SWIPE = SWIPES.map((s) => s.tipo) as TipoSwipe[];

export const SUBTIPOS_PAGINA = ["vendas", "captura", "advertorial", "checkout", "upsell", "obrigado", "outra"] as const;

export type Origem = "referencia" | "proprio";

export interface Etapa {
  id: string;
  tipo: TipoEtapa;
  titulo: string;
  /** O que acontece nesta etapa: palavra do comentário, mensagem da DM, texto da bio, promessa da página… */
  texto: string;
  x: number;
  y: number;
  /** Vínculos (todos opcionais): referência da biblioteca, post produzido do expert, item do swipe, página do vault, link externo. */
  ref?: string | null;
  /** Post do próprio expert feito no Hub: id da produção ("REF-…--slug") ou "car:<id do carrossel>". */
  producao?: string | null;
  swipe?: string | null;
  vault?: string | null;
  url?: string | null;
}

export interface Conexao {
  id: string;
  de: string;
  para: string;
  rotulo: string;
  /** Distribuição do tráfego que sai da etapa de origem (0–100). Null = não informado. */
  percentual: number | null;
}

export interface Funil {
  schema: "irh-funil/v1";
  id: string;
  nome: string;
  /** referencia = funil de concorrente/estudo; atual = funil do expert (o que está rodando ou vai rodar). */
  origem: Origem;
  /** Slug do perfil (expert) dono. Null = funil de referência geral. */
  expert: string | null;
  descricao: string;
  status: "rascunho" | "ativo" | "pausado" | "arquivado";
  etapas: Etapa[];
  conexoes: Conexao[];
  criado_em: string;
  atualizado_em: string;
}

export interface Swipe {
  schema: "irh-swipe/v1";
  id: string;
  tipo: TipoSwipe;
  titulo: string;
  /** Só para páginas: vendas, captura, checkout… */
  subtipo: string | null;
  origem: Origem;
  expert: string | null;
  /** @ do perfil de onde veio (bio/DM) ou dono da página. */
  autor: string;
  url: string;
  /** Texto do swipe: mensagem da DM, bio completa, perguntas do quiz, transcrição da dobra. */
  texto: string;
  notas: string;
  tags: string[];
  vault: string | null;
  /** Nome do arquivo de imagem (print) ao lado do JSON. */
  imagem: string | null;
  criado_em: string;
  atualizado_em: string;
}
