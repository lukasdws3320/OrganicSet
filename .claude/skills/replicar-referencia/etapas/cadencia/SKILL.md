---
name: replicar-cadencia
description: Planejar cortes e presets de uma replicação com timestamps por palavra, continuidade de fala e estados da ação, sem corte manual pelo usuário.
---

# Cadência, cortes e duração

Ler `../../SKILL.md` e o módulo de formato escolhido. A unidade de geração é o shot contínuo; takes são momentos visuais internos. Corte visual não exige interromper uma frase e vírgula não exige outra geração.

## Análise automática

No diretório do Hub:

```sh
bun run scripts/revisar-cadencia.ts --replication /caminho/replicacao.json
```

O comando lê `transcricao.json` da REF (ou `--transcript <arquivo>`), sem modificar dados ou abrir Flow. Retorna medições, propostas de união, `ajustesFronteiras` que levam bordas internas de palavras até os timestamps inteiros e janelas de resegmentação; exit 2 significa revisão bloqueada. O agente confere essas propostas contra o vídeo e materializa uma revisão pelo fluxo existente, sem pedir marcação manual de palavras ao Matheus. Usa palavras com início/fim reais, não taxa universal de palavras/s. A duração da janela de montagem é registrada separada da fala.

- Conferir texto literal, pausa real, fim de oração e fronteiras entre palavras. Preservar todas as palavras uma vez e na ordem. Taxa observada descreve a fonte; não prescreve o ritmo de outra personagem.
- Unir oração contígua quando fala e ação cabem e a continuidade visual permite. Uma mudança de gesto/pose não cria outra fala. Se houver corte físico incompatível com um shot contínuo, resolver a montagem ou o plano visual sem picotar palavras.
- Para fala maior que o preset, usar as propostas automáticas como ponto de partida e conferir o sentido na janela. Materializar a revisão pelo fluxo de análise/importação existente; reexecutar validação. Não manter em 8s com um aviso de risco, acelerar artificialmente ou cortar a fala para fazer passar. Não devolver ao Matheus a obrigação de marcar palavras manualmente.
- Fala adaptada, outro idioma ou outra interpretação não herda o tempo exato da fonte. Medir uma leitura/áudio disponível na interpretação pretendida ou registrar estimativa específica e conferir no piloto. Ausência de medição não vira 2,6/3,2 palavras/s universal.
- Inserto/POV com locução separada é dirigido pela ação; o tempo da narração entra na montagem. Um gesto rápido e uma fala rápida são decisões independentes.

## Plano

Escolher entre presets realmente suportados pelo modelo/modo registrados no Flow. O destino atual é principalmente Veo 3 em Frames; Elements/Ingredients pode ter outro conjunto de opções e não herda os presets sem conferência. A proposta local usa o contrato do modelo no Hub; confirmar as opções na UI antes do envio. Não preencher segundos com pausas nem encurtar para forçar pressa. Registrar por grupo: fala, sourceShots/sourceTakes, tempo medido/estimado e sua fonte, preset e ação completa. A regra de medição é comum a DTC, 3D e podcast; os valores vêm de cada fala/ação.

O exportador agora exige contexto vocal para fala gerada e lê timestamps para os novos planos. O resultado do analisador é proposta, com `authorizedByUser: false`: a autorização de geração vem do pedido vigente, não da medição. Revisão e manifesto de imagens entram no builder `flow_reviewed_frames.py` conforme o procedimento compartilhado. Planos antigos permanecem preservados; `duracaoOmni` sem medições é compatibilidade legada, não a regra para novos lotes.

Concluído quando não há fronteira no meio de palavra, fala que não cabe, frase dividida sem motivo ou ação truncada. A escuta do clipe gerado ainda é necessária para confirmar o resultado.

## Fechar o plano antes das imagens

Registrar uma linha por geração: origens, fala, ação inicial → transformação → resultado, duração da fonte, duração da fala de destino medida ou estimada (com a base da estimativa), preset de geração e corte de edição. Decimais da fonte não são presets. Não usar 8 s para tudo e cortar depois. Não mandar a personagem calar no fim de cada fragmento de uma oração; manter a intenção de continuação entre gerações quando o corte for necessário.

Antes de dividir por ingrediente/gesto, conferir se a troca de objeto é executável no mesmo cenário e cabe com fala e resultado no preset. Se sim, reunir. Antes de unir, conferir mudanças de cenário e resets dos objetos: quarto → fogão não cabe num plano único fixo. Resolver esse corte na montagem e conservar o encadeamento da fala. O total final de gerações pode ser menor ou maior que o de trechos analisados; a justificativa vem da continuidade e do limite real do modelo.
