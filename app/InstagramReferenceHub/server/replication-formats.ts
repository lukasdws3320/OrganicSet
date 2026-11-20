export const FORMATOS = ["EXPERT", "REACT", "RECEITA POV", "REAL→3D MESMO ÂNGULO", "REACT + ANIMAÇÃO", "RECEITA PASSO A PASSO", "CALKRAMER EXPERT", "PERSONAGENS FALANTES", "ALW FRUITS", "TROCA DE PRODUTO"] as const;
export type Formato = typeof FORMATOS[number];

/** Catálogo compartilhado por criação em lote, individual e edição. */
export const FORMAT_OPTIONS = FORMATOS.map(value => ({ value, label: ({ "EXPERT": "Expert", "REACT": "React", "RECEITA POV": "Receita POV", "REAL→3D MESMO ÂNGULO": "Real → 3D (mesmo ângulo)", "REACT + ANIMAÇÃO": "React + animação", "RECEITA PASSO A PASSO": "Receita passo a passo", "CALKRAMER EXPERT": "CalKramer Expert", "PERSONAGENS FALANTES": "Personagens falantes", "ALW FRUITS": "ALW Fruits", "TROCA DE PRODUTO": "Alteração pontual (trocar objeto, roupa, avatar ou cenário; resto igual)" } satisfies Record<Formato, string>)[value] }));

type Camadas = { fundo?: { presente: boolean }; react?: { presente: boolean } };
/** Só evidência clara; CalKramer, ALW e formatos novos exigem escolha explícita ou faceta. */
export function formatoDaAnalise({ shots }: { shots: { tipo: string; quem: string | null; camadas?: Camadas; composicaoSegmentos?: { camadas: Camadas }[] }[] }): Formato {
  const camadas = shots.flatMap(s => [s.camadas, ...(s.composicaoSegmentos ?? []).map(x => x.camadas)]);
  if (camadas.some(c => c?.react?.presente)) return camadas.some(c => c?.fundo?.presente) ? "REACT + ANIMAÇÃO" : "REACT";
  if (shots.length && shots.every(s => s.tipo === "inserto" && !s.quem)) return "RECEITA POV";
  throw new Error("Formato não mapeado pela análise: escolha o formato da replicação.");
}
