---
name: replicar-prompts-imagem
description: "Fabricar prompts de imagem inicial por ferramenta, formato e camada a partir de análise confirmada."
---

Ler [orquestrador](../../SKILL.md) antes desta etapa.

# Imagens iniciais por ferramenta

Ler contexto, análise visual e somente o formato necessário. A imagem representa o estado inicial, sem pedir uma sequência de ações num único frame. Usar `server/prompt-factory.ts` para adaptar a mesma direção ao destino.

Escolher identidade conforme o papel: troca de apresentador usa contact sheet exato; objeto falante usa a identidade do objeto, sem humano imposto; fundo sem avatar dispensa contact sheet; carrossel só usa identidade quando a mudança pede aquele expert. O nome do perfil não manda inserir rosto em todos os slides.

**Nano Banana 2.1/Pro:** conferir modelo disponível e vincular imagens reais. Referência 1 = frame para câmera, cenário e estado; referência 2 = contact sheet quando necessário para rosto, corpo, roupa e estilo. Dirigir a edição em prosa natural, com sujeito, composição, estado e acabamento relevantes. Não importar sintaxe de outro gerador nem inventar menções que a ferramenta não reconhece.

**ChatGPT:** anexos numerados e papéis explícitos, sem depender de @arquivo ou de caminhos locais que o chat web não lê. Pedir uma imagem por estado visual distinto, com composição e formato de saída. Toda instrução necessária entra no prompt copiável; a ficha do expert e a skill local não viajam pelo nome.

Em React + animação, produzir imagens do fundo e do plate separadamente; nenhum prompt tenta gerar ambos na mesma imagem. Nos inserts manter o recorte, sem rosto fora do quadro. Preservar objetos/quantidades e separar texto de edição do conteúdo real da cena.

Prompt curto e específico; usar restrições contra erros observados, sem repetir identidade/estilo em vários blocos. Conferir pixels gerados contra a fonte e a identidade antes de selecionar. Entrega manual inclui os prompts completos **no chat**, com anexos e ordem, além do arquivo/ZIP.

Em demonstrações, conferir o objeto inteiro e o destino da ação no recorte: boca da calha, área de queda, panela, líquido ou alimento devem continuar legíveis na mesma escala da fonte. Estado inicial já molhado/esvaziado/cozido não serve para mostrar a passagem do estado anterior. Para identidades com outro cabelo/roupa, preservar também a área útil das mãos/objetos. Selecionar o frame pelo início do shot planejado, inclusive quando vier de take interno; gerar somente a seleção usada.

Real fotográfico: base REC-01 do acervo de prompts (`server/replicacao-prompts.ts`), sem descrever a pessoa original; reconstruir a cena inteira com a identidade de destino, integrando rosto, corpo, mãos e ambiente na mesma luz, perspectiva, foco e textura. Não pedir corpo/fundo intocados com rosto trocado. Inspecionar integração óptica e estado inicial; beleza do rosto isolada não aprova a imagem. Usar correção localizada de estado em `stills[].extras` quando o frame amostrado já estiver no meio da ação.

## Reutilização de imagem-base

React, selfie, talking head e apresentador (EXPERT, CALKRAMER) com a mesma personagem, roupa, cenário, enquadramento e estado inicial usam uma única imagem-base para vários shots de vídeo. O exportador já agrupa: EXPERT e CALKRAMER por plano e estado; REACT e o plate de REACT + ANIMAÇÃO por pedido igual. Conferir no plano quantos `stills` restaram antes de gerar; se faltar agrupar, corrigir os dados da replicação em vez de pular imagens à mão. A base é gerada, selecionada e subida uma vez. Fala, duração ou número do shot diferentes não exigem outra imagem. Uma aprovação da base atende todos os dependentes daquele mesmo hash. Criar outra base somente quando mudar identidade, roupa, composição, câmera ou estado físico necessário. Preservar projetos separados por avatar e os vínculos de cada referência; reutilizar o arquivo não autoriza misturar identidades. O fundo do react continua sendo uma camada independente.
