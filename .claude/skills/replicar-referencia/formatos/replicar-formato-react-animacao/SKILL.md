---
name: replicar-formato-react-animacao
description: "Planejar fundo e avatar react como gerações separadas, inclusive hook composto seguido de talking head."
---

Ler [orquestrador](../../SKILL.md) antes desta etapa.

# React + animação

Ler análise visual e contexto. Inventariar segmentos reais: fundo+plate, só fundo, só talking head. Não supor react contínuo nem que todo fundo seja animado. Preservar o estilo observado de cada camada salvo adaptação explícita.

Criar duas trilhas independentes quando ambas forem necessárias: `fundo` (ação/ambiente sem avatar e sem fala do comentário) e `react` (avatar correto em selfie, frontal ou sentado conforme observado, com comentário/voz próprios). Contact sheet só no plate. Cada trilha tem imagem inicial, prompts, duração e fonte. Para a continuação só talking head, não criar fundo inútil.

A fala do react governa os cortes da montagem. Registrar sincronismo com evento, entrada/saída e canto inferior esquerdo/direito sem cobrir informação essencial. Canto e escala pertencem à edição, não viram pedido de composição no prompt do fundo. Preservar plate limpo recortável e seu enquadramento real; não impor frontal se a referência é selfie.

Conferir separadamente ambos os clipes e depois a composição. Retornar ao fluxo comum.

Para o plate recorrente, aplicar a reutilização de imagem-base em `../../etapas/prompts-imagem/SKILL.md`: vários clipes de fala podem usar a mesma imagem inicial. O número de falas não determina o número de imagens.

## Outro personagem na mesma REF (regra do Matheus, 06/11/2026)

Neste formato, um personagem novo na mesma REF gera **só a trilha `react`**. Fundos não são refeitos: receber nas imagens de fundo os mesmos arquivos (mesmos bytes) do personagem que já tem os fundos, e a fila os reaproveita (`sharedFrom`, zero crédito). Imagem do personagem enviada pelo Matheus vira o plate de todos os shots `react` (`receber-imagem` em cada STILL de plate), ajustada a 9:16 com a mesma cor de fundo, sem gerar outro plate. Não pedir confirmação disso.

Canto da personagem na edição: seguir o pedido do trabalho (ex.: esquerdo); o canto do prompt do plate não manda na montagem.
