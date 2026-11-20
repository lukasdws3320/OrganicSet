// Tipos compartilhados entre servidor e interface.

/** Derivado do ciclo desde a migração 11 (não é mais editável): usada = algum postado; producao = alguma em produção/pronta. */
export type Status = "disponivel" | "producao" | "usada";
/** Etapa de uma replicação (calculada a partir dos arquivos em library/replicacoes). */
export type Etapa = "analise" | "prompts" | "gerando" | "edicao" | "pronto" | "postado";
/** Ontologia única de status (SPEC §3). Ordem = avanço no ciclo. */
export type Stage = "guardada" | "triada" | "atribuida" | "producao" | "pronta" | "agendada" | "postada";
export const STAGES: Stage[] = ["guardada", "triada", "atribuida", "producao", "pronta", "agendada", "postada"];
export type PublicStage = "producao" | "pronto" | "agendado" | "no_ar";
export type Origem = "instagram" | "op001" | "mapeamento" | "upload";
export type ProfileTipo = "cliente_aw" | "expert_parceiro" | "operacao_propria_dr";
export type Kind = "video" | "imagem" | "carrossel";
export type Sort = "relevancia" | "recentes" | "antigos" | "publicacao" | "views" | "likes" | "comments" | "engajamento";

export interface Filters {
  q?: string;
  clients?: number[];
  projects?: number[];
  categories?: number[];
  tags?: number[];
  creator?: string;
  status?: Status[];
  favorite?: boolean;
  kind?: Kind[];
  cta?: string;
  publishedFrom?: string;
  publishedTo?: string;
  importedFrom?: string;
  importedTo?: string;
  minViews?: number;
  minLikes?: number;
  minComments?: number;
  minEngagement?: number;
  collection?: number;
  sort?: Sort;
  /** Valores de faceta por eixo: { formato: [ids], objetivo: [ids] } — OU dentro do eixo, E entre eixos. */
  facets?: Record<string, number[]>;
  /** Estágio derivado do ciclo (mais avançado entre os perfis). */
  stage?: Stage[];
  /** Slug do perfil, do personagem ou alias (ex.: bruno-goytacaz, bruno-goytacazes). */
  profile?: string;
  origem?: Origem[];
  /** Só referências sem @ do criador. */
  sem_criador?: boolean;
}

export interface Metrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
  collected_at: string;
  source: string;
}

export interface Chip { id: number; name: string; color?: string }

export interface RefCard {
  id: string;
  kind: Kind;
  source: "instagram" | "manual";
  username: string | null;
  display_name: string | null;
  caption_head: string;
  cta_keyword: string | null;
  published_at: string | null;
  imported_at: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  video_path: string | null;
  thumb_path: string | null;
  status: Status;
  favorite: boolean;
  metrics: Metrics | null;
  engagement: number | null;
  clients: Chip[];
  categories: Chip[];
  collections: Chip[];
  formato: Chip | null;
  cta_actions: { kind: string; label: string; detail?: string }[];
  /** Estágio mais avançado entre os perfis (SPEC §3.2, regra 9). */
  stage: Stage;
  /** Uma linha por personagem com replicação (REF × expert). */
  pipeline: RefPipeline[];
  media_count: number;
  /** Até 10 mídias no card; o detalhe traz todas. Slide não baixado = path null. */
  media: RefMedia[];
  creator_guess: string | null;
  origem: Origem;
  legacy_id: string | null;
  product_type: string | null;
  /** Valores de faceta por eixo (formato, estilo, objetivo, gancho, nicho). */
  facets: Record<string, FacetChip[]>;
}

export interface FacetChip extends Chip { source: "manual" | "auto" | "migracao" }

export interface RefMedia {
  position: number;
  type: "video" | "imagem";
  path: string | null;
  thumb: string | null;
  width: number | null;
  height: number | null;
}

export interface PipelineEvent { de: string | null; para: string; origem: string; detalhe: string | null; at: string }

export interface RefPipeline {
  /** ID da replicação: <REF>--<slug do personagem>. */
  id: string;
  profile: string | null;
  client: { id: number; name: string; slug: string };
  stage: Stage;
  /** Sub-rótulo: etapa e clipes ("Edição 6/6"), data do agendamento ou "ver ↗". */
  sub: string;
  late: boolean;
  etapa: Etapa;
  clips: number;
  clipsTotal: number;
  postUrl: string | null;
  postadoEm: string | null;
  agendadoPara: string | null;
  /** Posts desta replicação na Postagens.md (cada variação é um post). Só no detalhe da referência. */
  posts?: { total: number; postados: number; abertos: number; arquivados: number } | null;
  events?: PipelineEvent[];
}

/** Item do contrato único GET /api/pipeline (PainelExperts e ClientesRoadmap). */
export interface PipelineItem {
  id: string;
  ref: string;
  /** Legenda do post: real (publicado) → adaptada (legendas-post.json) → nota do perfil. Só na lista privada. */
  legenda?: string | null;
  /** post = a publicada · adaptada = legendas-post.json · nota = Postagens.md · referencia = a da referência só com o perfil trocado. */
  legenda_fonte?: "adaptada" | "nota" | "carrossel" | "referencia" | null;
  /** Posts (variações) desta replicação na nota do perfil: total sem os arquivados, postados e em aberto. */
  posts?: { total: number; postados: number; abertos: number };
  client_slug: string;
  client_name: string;
  profile_slug: string | null;
  etapa: Etapa;
  stage: Stage;
  sub: string;
  late: boolean;
  formato: string | null;
  clips: number;
  clipsTotal: number;
  editado_url: string | null;
  capa_url: string | null;
  post_url: string | null;
  postado_em: string | null;
  registrado_em: string | null;
  agendado_para: string | null;
  hub_url: string;
}

export interface PipelineResponse {
  /** Replicações arquivadas (fora da fila; nada apagado). */
  arquivados?: { id: string; ref: string; arquivado_em: string }[];
  /** Slug canônico do perfil (null quando a consulta é de todos). */
  profile: string | null;
  /** Slug pedido, quando era alias (ex.: bruno-goytacazes → bruno-goytacaz). */
  pedido?: string;
  lido_em: string;
  itens: PipelineItem[];
}

export interface PublicPipelineItem { ref: string; num: string; stage: PublicStage; post_url: string | null; postado_em: string | null }
export interface PublicPipelineResponse { profile: string | null; lido_em: string; itens: PublicPipelineItem[] }

export type StageCounts = Record<Stage, number> & { analise: number };

export interface Profile {
  ativo?: boolean;
  id: number;
  slug: string;
  name: string;
  tipo: ProfileTipo;
  instagram: string | null;
  vault_path: string | null;
  painel_slug: string | null;
  aliases: string[];
  personagens: { id: number; name: string; slug: string; avatar: string; color: string; ref_count: number; replicacoes: number }[];
  /** Referências atribuídas (distintas) aos personagens do perfil. */
  ref_count: number;
  /** Replicações (REF × personagem) do perfil. */
  replicacoes: number;
  stages: StageCounts;
}

export interface FacetValueCount { id: number; name: string; n: number }
export interface FacetsResponse {
  creators: { username: string; display_name: string | null; n: number }[];
  ctas: { keyword: string; n: number }[];
  kind: { value: Kind; n: number }[];
  stage: { value: Stage; n: number }[];
  origem: { value: Origem; n: number }[];
  criador: { username: string; display_name: string | null; n: number }[];
  sem_criador: number;
  profiles: { slug: string; name: string; n: number }[];
  /** Eixos de classificação; valores com contagem 0 só vêm com ?todos=1. */
  facets: { key: string; label: string; cardinality: "one" | "many"; values: FacetValueCount[] }[];
}

export interface Funnel {
  /** Referências sem replicação e sem expert atribuído. */
  sem_destino: number;
  /** Referências com expert atribuído e ainda sem replicação. */
  atribuida: number;
  analise: number;
  producao: number;
  pronta: number;
  agendada: number;
  postada: number;
  /** Detalhe por etapa das replicações (producao = prompts + gerando + edicao). */
  etapas: Record<Etapa, number>;
}

export interface RefDetail extends RefCard {
  shortcode: string | null;
  url: string | null;
  caption: string;
  hashtags: string;
  filmstrip_path: string | null;
  file_hash: string | null;
  file_size: number | null;
  cuts: number | null;
  avg_shot: number | null;
  notes: string;
  transcript: string;
  /** Ângulos por parte (hook/corpo), gerados na importação; null = ainda não analisado. */
  angulo_analise: import("./angulos").AnaliseAngulo | null;
  hook: string;
  script_structure: string;
  editing_technique: string;
  save_reason: string;
  adaptation: string;
  derived_ideas: string;
  updated_at: string;
  projects: (Chip & { client_id: number })[];
  tags: Chip[];
  collections: Chip[];
  markers: { id: number; t: number; label: string }[];
  metric_history: Metrics[];
  possible_duplicates: string[];
  file_exists: boolean;
  abs_path: string | null;
}

export interface ImportItem {
  id: number;
  job_id: number;
  url: string;
  shortcode: string | null;
  status: "pendente" | "baixando" | "ok" | "duplicado" | "erro";
  error: string | null;
  ref_id: string | null;
  updated_at: string;
}

export const STAGE_LABEL: Record<Stage, string> = {
  guardada: "Guardada", triada: "Triada", atribuida: "Atribuída", producao: "Em produção",
  pronta: "Pronta", agendada: "Agendada", postada: "Postada",
};

export const ETAPA_LABEL: Record<Etapa, string> = {
  analise: "Análise", prompts: "Prompts", gerando: "Gerando", edicao: "Edição", pronto: "Pronto", postado: "Postado",
};

export const ORIGEM_LABEL: Record<Origem, string> = { instagram: "Instagram", op001: "OP 001", mapeamento: "Mapeamento", upload: "Upload" };

export const STATUS_LABEL: Record<Status, string> = {
  disponivel: "Disponível",
  producao: "Em produção",
  usada: "Usada",
};

export const ANALYSIS_FIELDS = [
  ["hook", "Gancho utilizado"],
  ["script_structure", "Estrutura do roteiro"],
  ["editing_technique", "Técnica de edição"],
  ["save_reason", "Principal motivo para salvar"],
  ["adaptation", "Como adaptar para um expert"],
  ["derived_ideas", "Ideias derivadas"],
] as const;
