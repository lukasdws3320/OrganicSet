---
name: replicar-referencia
description: "Orquestrar análise contextual e replicação de vídeos do Reference Hub: resolver personagem e formato, encaminhar cadência/cortes e prompts, executar no Flow e revisar o resultado. Usar na criação, retomada ou correção de uma replicação."
---

# Replicar referência

Entrada comum por chat/UI e entrega para outro chat: ler `../reference-hub/SKILL.md`. Este módulo executa vídeo; carrossel usa o pacote próprio da entrada comum. Pedido fora do Hub não autoriza começar um workflow paralelo pelo navegador.

Fonte local: app/InstagramReferenceHub. Ler AGENTS.md, OPERACAO.md e GLOSSARY.md. A unidade é REF + expert/avatar + versão.

## Destino comum da produção

Direção vigente do Matheus (26/10/2026): vídeos DTC e dos experts convergem para imagens no Nano Banana ou ChatGPT, conforme o trabalho, e vídeo no **Flow, principalmente Veo 3**. O formato não escolhe outra engine. Frames é a preferência habitual para controlar a imagem inicial e a fidelidade; Elements/Ingredients é uma escolha consciente quando a composição exige referências adicionais. Conferir modelo, modo e presets reais da UI; o nome Flow identifica o ambiente de execução, não um modelo de vídeo. Rotas legadas de Omni/Seedance permanecem compatíveis, sem ser selecionadas silenciosamente para um trabalho Veo.

Voz cadastrada/menção não é obrigatória por padrão em Frames nem por ser um vídeo DTC. A exigência existente do Bruno pertence ao perfil dele. Direção de interpretação (infantil, idosa etc.) e vínculo técnico de voz são decisões distintas.

## Entrada e retomada

Ler o pedido e os dados do trabalho: GET /api/replicacoes/<REF>--<slug>, /producao, replicacao.json e, quando houver execução, flow-producao.json e flow-run.json. Retomar a análise e a mídia já conferidas. Não transformar auditoria em geração nem refazer a análise por troca de sessão/modelo.

Em trabalho existente, consultar o roteador local:

    bun run scripts/rotear-replicacao.ts --replication /caminho/replicacao.json

Ele retorna o módulo do formato, os módulos de produção, personagem, versão, estilo, engine e direção vocal. Direção ausente é contexto a resolver, não permissão para herdar a voz de outro personagem.

## Fluxo principal

Executar as etapas necessárias ao pedido; as já conferidas são reaproveitadas com evidência. Cada etapa possui instruções próprias:

| Etapa | Módulo obrigatório quando aplicável | Resultado |
|---|---|---|
| Entender vídeo e personagem; corrigir defaults | [Contexto](etapas/contexto/SKILL.md) | Identidade/apresentação vocal, fontes, objetivo, ação e formato resolvidos |
| Preparar a composição do formato | Módulo de formato abaixo | Presença em quadro, câmera, fala em quadro/off e montagem |
| Conferir quadros, camadas e fontes | [Análise visual](etapas/analise-visual/SKILL.md) | Duas leituras independentes e mapa validado |
| Fabricar imagem inicial | [Prompts de imagem](etapas/prompts-imagem/SKILL.md) | Prompt por ferramenta e camada |
| Fabricar movimento/fala | [Prompts de vídeo](etapas/prompts-video/SKILL.md) | Veo/Frames ou Elements justificado |
| Resolver cortes, frase e duração | [Cadência](etapas/cadencia/SKILL.md) | Palavras alinhadas, grupos/presets justificados e ação completa |
| Escrever imagens/vídeos; conferir geração ou delegar | [Prompts e revisão](etapas/prompts-e-revisao/SKILL.md) | Prompts enxutos, imagens corretas e resultado comparado com as fontes |

Contexto vem antes do preset e do prompt. No caminho de produção, concluir contexto + formato + cadência antes de enviar; depois conferir o resultado. O módulo não é uma sugestão de leitura: quem executa a etapa lê seu arquivo. Em delegação, cada executor recebe esses caminhos e um escopo próprio; o resumo do coordenador não substitui a leitura.

## Formato, estilo e personagem

| Formato | Módulo |
|---|---|
| EXPERT | [Apresentador](formatos/replicar-formato-expert/SKILL.md) |
| REACT | [Reação](formatos/replicar-formato-react/SKILL.md) |
| RECEITA POV | [Preparo em POV](formatos/replicar-formato-receita-pov/SKILL.md) |
| REACT + ANIMAÇÃO | [Camadas de reação](formatos/replicar-formato-react-animacao/SKILL.md) |
| RECEITA PASSO A PASSO | [Preparo por estados](formatos/replicar-formato-receita-passo-a-passo/SKILL.md) |
| CALKRAMER EXPERT | [Resolver benchmark](formatos/replicar-formato-calkramer/SKILL.md) |
| PERSONAGENS FALANTES | [Falantes](formatos/replicar-formato-personagens/SKILL.md) |
| ALW FRUITS | [Angry, Light or Worried](formatos/replicar-formato-alw/SKILL.md) |
| REAL→3D MESMO ÂNGULO | [Quadro real para 3D](formatos/replicar-formato-real-3d/SKILL.md) |
| TROCA DE PRODUTO | [Alteração pontual: objeto, roupa, avatar ou cenário muda; o resto fica igual](formatos/replicar-formato-troca-produto/SKILL.md) |

Ler [composição do trabalho](references/personagem-e-formato.md) quando resolver esses eixos. 3D/real é estilo; criança/adulta/idosa é apresentação da personagem; interpretação pertence à versão. Esta tabela é o registro atual, não uma lista completa dos formatos possíveis. Podcast, reação, demonstração ou encenação incomum são identificados pela análise do vídeo, inclusive direção do olhar, interlocutor e câmera. Não chamar todo enquadramento falado de EXPERT frontal. Formato não mapeado precisa ser resolvido antes de gerar, sem fallback silencioso para EXPERT; compartilhar o destino Flow/Veo não torna os formatos iguais.

O pedido controla replicação fiel versus adaptação. Preservar fala literal e imperfeições intencionais; mudanças de personagem não reescrevem receita, copy ou CTA. Fontes antigas da OP 001 ajudam a reconhecer padrões, sem importar aceleração, idioma, conta, voz, projeto ou regras de outro formato.

## Análise e imagens

Para fonte nova, a fila de preparação cruza transcrição por palavra, Watch + Opus/Sonnet 5.5 low e frames timestampados; o mapa é validado conforme server/analise.ts antes dos prompts. Conferência automática não é revisão humana. Uma transformação, mão/objeto ou ação ambígua exige conferir a janela específica; análise pronta não autoriza inventar o que não foi observado.

Imagem inicial: uma por base visual distinta do plano de produção final, com origem explícita; vários shots podem usar a mesma base ([reutilização](etapas/prompts-imagem/SKILL.md)). Não gerar nem entregar todos os takes da análise. Um take interno pode ser a origem necessária de um shot após resolver uma mudança real de cenário/estado. Aplicar a seleção em [execução](etapas/execucao/SKILL.md), sem impor o take `.1` nem transportar a contagem de trechos para a produção. Frame do take da própria REF; contact sheet somente quando há identidade dessa personagem na camada. Frame governa ação/estado/câmera; contact sheet governa identidade/roupa/estilo. Inserto sem rosto mantém o recorte. Reutilizar mídia já escolhida; usar o provedor pedido para novas imagens, sem troca silenciosa.

Guardar imagens versionadas em <REF>/<slug>/gerados/<versao>/ e selecionar com manifesto flow-selected-images/v1: REF, expert/avatar, hash do contact sheet, arquivo/hash de cada imagem, take/frame de origem e estado selecionado. Em Frames, o anexo de vídeo é a imagem inicial escolhida; o contact sheet não vira segundo frame por padrão.

## Execução no Flow

Entrada operacional vigente: [execução compartilhada por Hub/chat](etapas/execucao/SKILL.md). A fila persistida decide os próximos itens e usa o controlador abaixo. Trocar de LLM não exige refazer análise/revisões já válidas. Aprovação de imagem Flow libera automaticamente seu vídeo, sem esperar imagens ou renders de outros shots.

Produção de qualquer formato passa só pela fila (`hub.ts`), que já chama o controlador: o agente não executa `flow_execute_shot`, `execute-plan`, `run-batch` ou `collect-batch` nem aciona o navegador. O restante desta seção descreve o controlador. Ler e aplicar somente em manutenção dele ou em plano legado sem `producao-workflow.json`, nesses casos antes de upload/preparo/envio:

- app/GoogleFlowMCP/AGENTS.md
- app/GoogleFlowMCP/docs/execucao-compartilhada.md
- Em vários personagens, app/GoogleFlowMCP/docs/escala-personagens.md
- Em lote, espera, retomada ou entrega, app/GoogleFlowMCP/docs/execucao-eficiente.md

O perfil library/experts/<slug>/producao.json fixa contact sheet físico/hash, projeto, modelo/modo, proporção, resolução, count e política de áudio daquele expert. Sem perfil confirmado, resolver o cadastro inicial com seus próprios materiais. Timbre livre não significa voz adulta genérica nem dispensa direção de interpretação.

O exportador scripts/exportar-lote-flow.ts exige contexto vocal de fala gerada e timestamps, sem exigir voz cadastrada por esse motivo. Na rota Frames, a revisão de cadência e o manifesto de imagens entram no builder flow_reviewed_frames.py. Esse builder só aceita Frames: Elements/Ingredients exige o plano correspondente no controlador, com referências e papéis próprios, sem renomear Frames para forçar compatibilidade. Preparar um plano por personagem. O lote é conferido offline por flow_audit_batch ou flow-control run-batch --manifest antes de qualquer envio.

Executar pelo controlador flow_execute_shot {plan, shot_number, submit} ou CLI equivalente. submit:false prepara; submit:true envia no escopo autorizado. Resolver shot_number pela numeração de produção do plano/API, não pelo ID legado do trecho. Uma aba é serial; lotes podem sobrepor envios em abas isoladas pelo CLI canônico `prepare-batch-tabs` + `run-batch --workers N --targets <arquivo> --submit`, preservando orçamento e locks. Não esperar cada render para enviar o próximo trabalho independente. Downloads têm lock compartilhado.

Usar `collect-batch` para a coleta em rodízio e prazos por shot; `batch-status`/MCP `flow_batch_status` dão resumo compacto. O CLI aguarda sem consumir chamadas de modelo e devolve resultado ou pendência concreta. Recuperar resultado ausente antes de retake; nenhum comando de coleta gera mídia. Revisar/organizar os trabalhos prontos enquanto as exceções são tratadas, com orçamento separado e versões preservadas.

O controlador confere identidade/hashes, projeto/coleção na raiz, imagem anexada por ID, voz/política de áudio, prompt literal, modelo, preset, count, cotação e orçamento. Voz mencionada não comprova timbre. Timeout/estado incerto exige recuperar mídia existente antes de outra tentativa autorizada. Preservar planos com envios; mudanças de identidade, voz, cadência ou prompt geram versão nova.

## Conclusão

Conduzir a etapa autorizada até seu resultado comprovado. Distinguir imagem escolhida, upload, preparo, envio, clipe coletado, revisão técnica, edição e aprovação humana. Arquivo/hash/duração comprovam mídia; voz, início/fim audíveis, dicção e ação exigem revisão do conteúdo. Atualizar o Hub pelos dados persistidos.

Entrega usa `build-delivery` + `audit-delivery` (ou MCP `flow_audit_delivery`), com recibo visual/auditivo e hash de cada clipe final. Retake exige revisão própria; uma frase global “revisado pelo Opus” não preenche a evidência. Modelos e esforço são registrados conforme as chamadas observadas. Preparar briefings curtos e revisar somente artefatos novos/alterados; acompanhamento e coleta ficam no código, sem agentes LLM de polling.

Para recuperar decisões históricas específicas, consultar references/historico-producao-ate-2026-10-24.md. A direção vigente do trabalho e os módulos atuais prevalecem sobre receitas históricas conflitantes.
