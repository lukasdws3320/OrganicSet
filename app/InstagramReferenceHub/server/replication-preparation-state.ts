
export type Preparation = {
  schema: 1; id: string; ref: string; slug: string | null; expert: string | null;
  input: { ref: string; expert_id?: number; formato: string; engine: string };
  status: "fila" | "preparando" | "aguardando_conferencia" | "pronto" | "erro";
  criado_em: string; atualizado_em: string; erro?: string; fase?: "segmentando" | "analisando" | "conferindo" | "prompts";
};
export function preparationLabel(p: Pick<Preparation,"status"|"erro"|"fase">): string {
  return p.status === "fila" ? "Na fila de preparação" : p.status === "preparando" ? ({segmentando:"Preparando trechos e frames",analisando:"Analisando a referência",conferindo:"Conferindo o mapa automaticamente",prompts:"Preparando os prompts"}[p.fase ?? "segmentando"]) : p.status === "aguardando_conferencia" ? "Aguardando conferência da análise" : p.status === "pronto" ? "Preparação concluída" : `Erro na preparação: ${p.erro ?? "consulte os detalhes"}`;
}
