import { Producao } from "./Replicacoes";

/** /producao/:slug (rota antiga): agora é a Produção filtrada pelo expert (?expert=). Slug por alias resolvido no Hub. */
export function ProductionOverview({ slug }: { slug: string }) {
  return <Producao expert={slug} />;
}
