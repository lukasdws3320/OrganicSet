import type { Formato } from "./replicacao-prompts";

/** Format selects production instructions; character and visual style stay independent. */
export const FORMAT_MODULES = {
  "EXPERT": "formatos/replicar-formato-expert/SKILL.md",
  "REACT": "formatos/replicar-formato-react/SKILL.md",
  "RECEITA POV": "formatos/replicar-formato-receita-pov/SKILL.md",
  "REAL→3D MESMO ÂNGULO": "formatos/replicar-formato-real-3d/SKILL.md",
  "REACT + ANIMAÇÃO": "formatos/replicar-formato-react-animacao/SKILL.md",
  "RECEITA PASSO A PASSO": "formatos/replicar-formato-receita-passo-a-passo/SKILL.md",
  "CALKRAMER EXPERT": "formatos/replicar-formato-calkramer/SKILL.md",
  "PERSONAGENS FALANTES": "formatos/replicar-formato-personagens/SKILL.md",
  "ALW FRUITS": "formatos/replicar-formato-alw/SKILL.md",
  "TROCA DE PRODUTO": "formatos/replicar-formato-troca-produto/SKILL.md",
} as const satisfies Record<Formato, string>;

export const PRODUCTION_MODULES = {
  contexto: "etapas/contexto/SKILL.md",
  analiseVisual: "etapas/analise-visual/SKILL.md",
  cadencia: "etapas/cadencia/SKILL.md",
  imagens: "etapas/prompts-imagem/SKILL.md",
  video: "etapas/prompts-video/SKILL.md",
  promptsRevisao: "etapas/prompts-e-revisao/SKILL.md",
  execucao: "etapas/execucao/SKILL.md",
} as const;

type RoutingInput = {
  slug: string; avatar: string; formato: string; engine: string; avatar_estilo: "3d" | "real";
  copy: { ativa: string; versoes: { id: string; direcao_voz?: string }[] };
};

export function routeReplication(rep: RoutingInput, version = rep.copy.ativa) {
  if (!Object.hasOwn(FORMAT_MODULES, rep.formato)) throw Error(`Formato sem módulo: ${rep.formato}`);
  const selected = rep.copy.versoes.find(v => v.id === version);
  if (!selected) throw Error(`Versão inexistente: ${version}`);
  return {
    schema: "replication-route/v1",
    format: rep.formato,
    formatModule: FORMAT_MODULES[rep.formato as Formato],
    productionModules: PRODUCTION_MODULES,
    style: rep.avatar_estilo,
    engine: rep.engine,
    version,
    character: { slug: rep.slug, avatar: rep.avatar, voiceDirection: selected.direcao_voz?.trim() || null },
  };
}
