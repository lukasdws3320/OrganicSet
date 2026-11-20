# Um processo, várias entradas

O Reference Hub reúne biblioteca, execução e visualização. Seu backend coordena importação, análise, preparação e leitura de produção. A UI e scripts/hub.ts chamam a mesma API. GoogleFlowMCP continua sendo o controlador de produção de vídeo; o Hub lê seus artefatos. Nada disso depende de começar a conversa na pasta do app.

## Donos e limites

| Responsabilidade | Fonte |
|---|---|
| Regras e entrada de execução | .claude/skills/reference-hub/SKILL.md neste app |
| Vídeo, formato, cadência e revisão | .claude/skills/replicar-referencia/ neste app |
| Referência, legenda, análise e vínculos | library/ e API do Hub |
| Identidade técnica por personagem | clients + library/experts/<slug>/; contact sheet física conferida |
| Contexto comercial e entregas do expert | experts/<tipo>/<expert>/ no vault |
| Ensino/método DTC e kit dos alunos | 05_Biblioteca/OrganicoDTC/ no vault; não define outro executor de produção |
| Upload/envio/coleta Flow | GoogleFlowMCP, planos e recibos versionados |

Conteúdo orgânico e anúncio podem usar o mesmo executor; público, copy, oferta e aprovação pertencem ao trabalho. Separação de pastas organiza responsabilidades, não cria regras de execução concorrentes.

## CLI e contrato

Executar de qualquer cwd com bun + caminho absoluto de scripts/hub.ts. ajuda lista as opções. IRH_URL ou --base escolhem API local; CLI não inicia serviço ocultamente, não acessa credenciais e não cria um banco paralelo.

| Comando | API / efeito |
|---|---|
| contexto [--ref REF] [--expert SLUG] | GET /api/execucao; fontes, identidade e estado do mesmo banco |
| importar --url URL [--expert SLUG] | POST /api/import; fila do importador da UI |
| importacao --id JOB | GET /api/import/jobs/:id |
| preparar --ref REF --expert SLUG --formato FORMATO --engine ENGINE | POST /api/replicacoes; preparação de vídeo em segundo plano |
| status --id REF--SLUG | GET /api/replicacoes/:id |
| producao --id REF--SLUG | GET /api/replicacoes/:id/producao |
| executar --id REF--SLUG | GET /api/replicacoes/:id/execucao; fila, arquivos e prompts completos |
| executar --id ID --gerador manual\|chatgpt\|flow --creditos LIMITE --gerar sim\|nao --editor ffmpeg\|opencut | POST na mesma rota; geração só com autorização explícita persistida |
| executar --id ID --gerar sim [--creditos LIMITE] | retoma produção existente; sem --creditos mantém o teto gravado |
| coletar --id ID | POST .../execucao/coletar; reabre a coleta de envios por 15 min, sem gerar, autorizar ou mudar teto |
| aprovar-imagem --id ID --item STILL01[,STILL02] | aceita hash atual, libera vídeos dependentes; em lote, uma leva só de upload |
| reprovar-imagem --id ID --item STILL01 --motivo TEXTO | preserva tentativa anterior e solicita correção |
| receber-imagem --id ID --item STILL01 --arquivo /imagem.png | recebe bytes, valida, nomeia e organiza a imagem externa |
| reenviar-item --id ID --item ITEM --motivo EVIDENCIA | envio incerto após coleta esgotada; nunca enviado não consome o teto; item em transação recusa |
| atualizar-prompts --id ID --itens STILL01,STILL02 | refaz prompts de imagens não aprovadas a partir da replicação; recusa REACT + ANIMAÇÃO |
| autorizar-tentativa --id ID --item ITEM --motivo TEXTO --autorizacao "quem e quando" [--duracao 4\|6\|8] | POST .../execucao/ITEM/tentativa; refaz clipe em erro ou disponível, uma vez por item, só com autorização explícita |
| pacote-chat --ref REF --expert SLUG --alteracoes-file ARQUIVO --assinatura @perfil [--identidade none\|expert] | POST /api/refs/:ref/pacote-chat; fontes e instruções para carrossel |

Pacotes de chat versionados em library/exports/chat/<REF>/<expert>/<UUID>/. GET /api/refs/:ref/pacotes-chat lista, e /pacotes-chat/:expert/:UUID baixa o ZIP. A ficha da referência usa as mesmas rotas. Legenda original permanece literal e separada da legenda adaptada/publicada. Pacote preparado não altera etapa para gerado/pronto. Chat web sem acesso ao Mac opera com os arquivos anexados, não executa a API localhost; uma integração remota seria outro trabalho.

## Verificação de descoberta

scripts/auditar-entrada.ts verifica os links de instalação e os ponteiros da raiz, experts e setup. Claude e Codex recebem links para a fonte única, não cópias. Sessões já abertas podem não atualizar o catálogo de skills; o ponteiro em AGENTS.md permite ler a fonte diretamente, e sessões novas descobrem os links instalados.

Teste de contrato: bun test tests/execution-entry.test.ts. Usa biblioteca temporária, API real e CLI em outra pasta. Não usa provedores pagos. Não prova a qualidade de uma geração futura nem obriga todos os modelos a raciocinarem igual.

A identidade é condicional: usar --identidade none para carrossel sem substituição pelo expert e expert quando o contact sheet governa a aparência. Entrega manual inclui o prompt integral no chat. Análise de vídeo: módulo etapas/analise-visual (Watch local + duas leituras Opus/Sonnet 5.5 low); falha Gemini não bloqueia essa rota. Prompts de imagem e vídeo são módulos separados e a fábrica adapta anexos por ferramenta e camadas por composição.

## Produção padronizada

Ler `.claude/skills/replicar-referencia/etapas/execucao/SKILL.md`. O estado fica em `producao-workflow.json` na replicação; tentativas têm prompt, anexos, hashes, posse e decisão. A UI usa as rotas acima. A resposta de `executar` traz `nextAction`, calculado do estado, igual para Hub, Claude e Codex: `receber_imagens`, `autorizar`, `executar_fila`, `aprovar_imagens`, `aguardar_coleta`, `coletar`, `resolver_erro` ou `editar`. `preparar --experts slug,slug` prepara vários avatares sem esperar o anterior terminar. Uma troca de LLM reutiliza análise e mídia válidas.

ChatGPT: `scripts/chatgpt-image.ts` chama `codex exec` autenticado, em pasta temporária isolada, com anexos em ordem e ferramenta nativa de imagens. Retorna arquivo e recibo; Claude chama o mesmo backend/CLI. Não usa o navegador nem troca para uma API/gerador diferente quando falha. Um recibo íntegro permite recuperar sem gerar outra vez. A geração nativa e a chamada de recuperação via Claude foram exercitadas em 29/10/2026, nos artefatos de `docs/evidencias/entrada-compartilhada-2026-10-29/` e na pasta `gerados/ponte-chatgpt-2026-10-29/` da REF0200/loira.

Flow: as submissões seguem para a fila sem aguardar o render anterior; vídeos prontos para envio não aguardam imagens independentes. Imagens feitas no Flow entram em aprovação humana; comentário é obrigatório ao reprovar. A aprovação pertence ao hash e libera o vídeo sem outra pergunta: os mesmos bytes não pedem nova decisão na produção. Planos por tentativa carregam identificador único de submissão para evitar colisão entre prompts iguais. Envios incertos entram em coleta, sem repetição de geração. Acompanhamento local é limitado a 15 minutos por janela; `coletar` reabre a coleta preservando a tentativa. Aba e janela são mecânica do controlador: o agente não aciona nem traz o navegador à frente.

Fundo de REACT + ANIMAÇÃO (`layer: fundo`, sem fala) é gerado uma vez por REF: mesma versão, pedido, janela, duração, modelo/modo/resolução/proporção/count e hash da imagem aceita reaproveitam o clipe entre personagens, antes de qualquer envio, com `sharedFrom` e evento `video_reused`. Fonte em curso deixa o dependente em `waiting_shared`; fonte com erro não dispara nova geração: `waiting_shared` traz o erro e a recuperação é na origem. React nunca é reaproveitado entre identidades. Retake autorizado gera de verdade.

Manual: o pacote de vídeo inclui original, legenda literal, anexos por papel, prompts integrais ChatGPT/Nano Banana/Veo e manifesto. Baixar em `/api/replicacoes/<id>/execucao/pacote`. O agente também entrega os prompts integrais no chat. Arquivo de entrada recebido é renomeado pelo backend; o chat externo não precisa conhecer a pasta do expert.

Edição: clipes coletados geram manifesto com ordem, camadas, fala, presets e hashes para FFmpeg/OpenCut. O arquivo não significa montagem concluída. Pequenos acréscimos/omissões nas bordas são nota de edição aceita pelo usuário; não provocam retake automático ou novo ciclo de análise.


## Contrato de execução e transferência (04/11/2026)

A interface organiza e reflete o backend; nenhuma regra de execução depende de uma tela ou desta conversa. CLI, UI e outros agentes chamam o mesmo serviço e retomam `producao-workflow.json`, planos fixados, recibos e `REGISTRO.md`. Handoff local usa `contexto` e `executar`; o servidor da API precisa estar ativo, a interface pode estar fechada. Handoff para chat sem acesso ao Mac recebe o pacote autossuficiente com arquivos e papéis, como descrito acima.

Na mesma referência, a fila compartilha imagens iniciais e clipes de fundo sem avatar quando as fontes, a direção e a configuração são equivalentes. `sharedFrom` registra origem e hash; `waiting_shared` aguarda essa origem, sem chamar o gerador nem cobrar outro vídeo. Personagem/voz e sua camada de comentário continuam separados. Trocar de executor ou abrir outra sessão não muda essas decisões. Mudança real de conteúdo/configuração exige versão própria.

A coleta lê todos os planos pendentes da coleção numa varredura, preserva o índice de assets já examinados e serializa downloads entre targets. Ela não reproduz vídeos para baixar, não traz o navegador à frente e não gera mídia. Falhas ficam por item no registro; recuperação da coleta não cria tentativa de geração. A duração do fundo vem da ação, e a do comentário vem da fala medida. O formato é explícito ou sai da classificação/análise confirmada; ausência não vira EXPERT silenciosamente.
