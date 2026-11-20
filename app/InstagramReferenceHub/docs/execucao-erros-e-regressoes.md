# Execução compartilhada — falhas corrigidas e regressões

Este contrato pertence ao backend de produção e ao controlador Flow. A interface é cliente e reflexo dele. Vale para execução pela CLI, por qualquer agente local, pela interface e para o handoff de uma etapa. Fontes: `docs/execucao-por-chat.md`, `.claude/skills/replicar-referencia/etapas/execucao/SKILL.md`, `server/production-*.ts` e `GoogleFlowMCP/scripts/flow_*.py`.

| Falha observada | Regra executável e fonte | Regressão |
|---|---|---|
| Claude responder “Not logged in” no serviço com sessão válida no Mac | O leitor/sintetizador completa USER e LOGNAME ausentes a partir da conta do processo antes de chamar o CLI; não copia token nem depende do shell aberto. `scripts/visual_analysis.py` | `visual_runner_test.py` (ambiente mínimo e chamada efetiva do subprocesso) |
| Cache antigo conter janela de análise acima de oito segundos | A síntese divide somente janelas longas em fronteira do ASR, priorizando fim de frase. Mantém palavras, cobertura e as duas leituras válidas; feedback ao LLM não tenta consertar uma janela imposta pelo próprio código. `scripts/analysis_windows.py`, `conferir-mapa.py` | `analysis_windows_test.py` |
| Repetir análise ao trocar de avatar/agente | Evidências por hash; mapa em uso não é reescrito na preparação de outro avatar. `replication-preparation.ts` | `replication-preparation.test.ts` |
| Escolher EXPERT em silêncio | Formato explícito, faceta ou análise inequívoca. Ausência de mapeamento vira erro localizado, nunca outro formato. `replication-formats.ts` | `replication-format-default.test.ts` |
| Imagem por fragmento de fala | Bases visuais distintas, sem copiar contagem de takes para geração. `lote-flow.ts` | `lote-flow.test.ts` |
| Gerar de novo o mesmo fundo para outro avatar | Imagem de fundo compartilhada pelo pedido/anexos; vídeo compartilhado por direção, imagem/hash, janela, duração, modelo e configuração na mesma REF. `production-workflow.ts` | `production-fundos.test.ts` |
| Dois avatares dispararem o mesmo fundo ao mesmo tempo | Dono determinístico e `waiting_shared`; o outro aguarda sem chamar gerador. Personagens/voz próprios não compartilham plate. | `production-fundos.test.ts` |
| Arquivo reaproveitado sem fonte | `sharedFrom` registra origem, arquivo e hash. Conteúdo ausente/alterado bloqueia recuperação na origem, sem regeneração paralela. | `production-fundos.test.ts` |
| Fundo herdar tempo menor do comentário | Camada sem fala usa tempo da ação; comentário usa timestamps da fala. Retomada concilia só trabalhos ainda não enviados. `lote-flow.ts`, `production-workflow.ts` | `lote-flow.test.ts`, `production-fundos.test.ts` |
| Reaprovar os mesmos bytes | Aprovação é por hash; recebimento repetido não apaga a decisão. Bytes novos mantêm revisão própria. | `production-padronizacao.test.ts` |
| Reenviar durante uma transação | `running` não pode ser reaberto. Intenção de envio existente exige coleta. Falha comprovadamente anterior ao envio pode voltar à fila sem gastar recuperação paga. | `production-padronizacao.test.ts` |
| Coleta reabrir toda a galeria para cada clipe | Uma varredura atende todos os planos pendentes; índice persistente por asset/editor/prompt. Sem Play/Mute para baixar. `production-runner.ts`, `flow_collect_videos.py` | `test_flow_collection_cache.py`, `production-padronizacao.test.ts` |
| Leitura incompleta virar “asset alheio” permanente | Coletor espera controle de editor pronto e prompt populado/estável antes de gravar a observação. | `test_flow_collection_cache.py` |
| Falha transitória provocar ciclos visuais indefinidos | Limite de tentativas de download e intervalo entre tentativas; falha fica por item. `coletar` reabre só recuperação, sem criar geração. | `test_flow_collection_cache.py`, `production-padronizacao.test.ts` |
| Envio incerto perder a intenção de cobrança | Intenção nos eventos do `flow-run` prevalece mesmo sem acknowledgment no item. Não vira tentativa “gratuita”. | `production-padronizacao.test.ts` |
| Recusa explícita ficar eternamente como renderização | Coletor associa a recusa ao prompt completo e tag da tentativa por `Reuse prompt`; nunca clica `Retry`. Executor grava `provider_refused`, preserva plano/imagem e encerra coleta sem nova geração automática. | `test_provider_failures.py`, `production-padronizacao.test.ts` |
| Nome da imagem inicial fazer coletor ignorar vídeo novo | Só nomes no padrão de clipe já coletado podem ser filtrados; prefixo REF em upload não basta. | `test_provider_failures.py` |
| Cache confundir assets por query | ID exato prevalece; parâmetros de identidade permanecem; só assinatura é removida. Nome com identificador de tentativa é alias conferido. | `test_flow_collection_cache.py` |
| Downloads de referências diferentes disputarem o Chrome | Fila global de coleta, além da serialização por target e trava de download no controlador. | `production-padronizacao.test.ts` |
| Falha de um grupo impedir o outro | Leitura por job e coleta/registro por tipo isolados; progresso já obtido é preservado mesmo com falha parcial. | `production-api.test.ts`, testes da fila |
| Navegador vir à frente ou janelas serem rearranjadas | Foco/renderização emulados por target, criação em fundo no mesmo perfil Flow e sem reposicionar janelas. `flow_control.py`, `flow_parallel.py` | `test_flow_background_policy.py`, `test_flow_account_tabs.py`, `test_flow_parallel.py` |
| Falha de criação multiplicar abas | Intenção persistida e recuperação do target antes de outra criação. Targets preexistentes são preservados. | testes de targets do Flow |
| Preço ainda carregando bloquear tentativa válida | Uma abertura de configurações, espera limitada pela cotação real; ausência/ambiguidade ainda bloqueia gasto. | `test_flow_control.py` |
| Mesma REF curta indicar dois materiais | Contador monotônico, persistente e independente do mês; IDs completos na exibição/busca/evidências. IDs históricos não são renomeados. | `numeracao-refs.test.ts` |
| Perfil antigo continuar como opção ativa | Estado cadastral no backend; histórico preservado; novas replicações e agenda automática respeitam inatividade. | `replication-catalog.test.ts`, `agenda.test.ts` |

## Retomada e handoff

1. Resolver referência completa, personagem e limite autorizado por `hub.ts contexto`.
2. Consultar `hub.ts executar --id REF--SLUG`. O estado persistido e `nextAction` determinam o próximo passo; outra sessão não repete análise, seleção ou geração.
3. `waiting_shared` aguarda a fonte indicada em `sharedWait`. Erro compartilhado é tratado nessa origem. `sharedFrom` comprova o vínculo do reaproveitamento, sem inventar uma submissão própria.
4. `coletar --id ID` é recuperação de mídia existente. Não altera orçamento nem autoriza outro envio. Repetição de geração tem tentativa, motivo e autorização registrados.
5. Handoff de edição usa manifesto com ordem, camadas, falas, arquivos e hashes. Clipe coletado e manifesto não significam montagem ou aprovação humana concluídas.
6. Quem recebe uma etapa sem conexão local recebe o pacote completo com arquivos e prompts, não apenas um nome de expert ou URL localhost.

## Verificação de manutenção

Backend: `bun test`, `bun run typecheck`, `bun run build`, `bun scripts/auditar-entrada.ts`. Controlador: Python do Browser Harness com `-m unittest discover -s tests -p 'test_*.py'`, mais build/testes Node quando os arquivos TypeScript forem alterados. Testes de regressão usam bibliotecas temporárias e não geram mídia. A validação real de um lote registra separadamente imagem gerada, envio, coleta, revisão de conteúdo e aprovação humana. Uma alteração de código não reclassifica retrospectivamente um clipe como revisado.
