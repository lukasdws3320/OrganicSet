---
name: replicar-execucao
description: Executar ou retomar a produção preparada do Reference Hub por qualquer LLM local, com escolha do gerador, imagens, aprovação Flow, vídeos e handoff para FFmpeg/OpenCut.
---

# Execução compartilhada

Quando este módulo for aberto isoladamente, ler [o contexto da replicação](../../SKILL.md); se já estiver carregado, continuar do estado persistido.

Usar quando a análise/prompts já estão preparados, ao gerar mídia ou trocar de LLM, em qualquer formato. Ler o estado pela CLI antes de qualquer ação. CLI absoluta: `app/InstagramReferenceHub/scripts/hub.ts`.

## Regras fixas do Matheus (valem para Claude, Codex e qualquer agente)

- **A execução já existe.** Usar só `hub.ts` e a fila do Hub. Não escrever script próprio, não abrir o Flow no navegador e não alterar controlador com lote em andamento. Se o setup falhar: parar o lote, relatar, corrigir com teste e só então retomar. `FlowControl` recusa script avulso.
- **Conta:** Flow sempre no perfil Chrome Flow (`chromeProfile` de connection.json), conta Ultra `<e-mail da conta Ultra em ~/.config/google-flow-mcp/connection.json>`. O controlador lê a conta na página e recusa outra. Veo Lite mostrando só 8 s é sinal de conta errada: não contornar.
- **Navegador:** o agente não abre, não foca e não traz janela à frente; nesta etapa ele nem aciona navegador. Aba, janela e visibilidade são mecânica interna da fila e do controlador (`ensure-tab`, `IRH_FLOW_TABS`). Chrome fechado ou daemon caído não é bloqueio: o controlador abre o Chrome Flow em segundo plano (`open -g`) e aprova a depuração sozinho; não pedir isso ao Matheus. Se mesmo assim falhar, `executar --id ID --gerar sim` retoma depois da correção. Recusa por aba ausente ou escondida: relatar o erro registrado e parar o lote, sem contornar pelo navegador. A aba de outra tarefa não é motivo de recusa.
- **Upload:** a fila sobe por `upload-images` todas as imagens liberadas, com reaproveitamento por hash. Receber as imagens antes de autorizar e aprovar em lote (`aprovar-imagem --item STILL01,STILL02`) para saírem numa leva só. Nunca subir uma por uma à mão.
- **Aprovação por hash:** a decisão registrada vale para os mesmos bytes em toda a produção. Reenviar o mesmo arquivo ou usá-lo em outra imagem não pede nova aprovação; bytes diferentes pedem. Consultar `jobs[].decision` antes de pedir qualquer aprovação.
- **Outro personagem em REACT + ANIMAÇÃO:** só a trilha react é gerada; os fundos chegam reaproveitados recebendo os mesmos arquivos de fundo (detalhe no módulo do formato).
- **Fundo compartilhado:** na mesma REF, imagens e clipes de fundo sem avatar são gerados uma vez. A fila confere prompt/ação, imagem por hash, janela, duração e configuração; registra `sharedFrom` quando reutiliza. `waiting_shared` aguarda a fonte, sem enviar outra geração. Erro é recuperado na origem. Plates/vozes de personagens diferentes permanecem próprios.
- **Hub é reflexo:** o que acontece fica no backend. Cada produção tem `REGISTRO.md` ao lado do `producao-workflow.json`, escrito pelo backend, com ação, item, tentativa, autor e erro.
- **REF curta:** `contexto --ref REF-0233 --expert SLUG` resolve a REF completa. Nutri Giovana = `fabiola`; Giovana Castro = `giovana-castro`; são personagens diferentes.
- **Envio incerto sem mídia:** nenhuma repetição automática. Rodar `coletar --id ID`, que reabre a coleta por 15 min e nunca gera. Só com a coleta esgotada, `reenviar-item --id ID --item ITEM --motivo EVIDENCIA` abre uma tentativa nova; a segunda ausência bloqueia. Item nunca enviado (sem plano fixado ou sem intenção registrada) volta à fila sem consumir esse teto; item em transação não reabre.
- **Refazer um clipe:** nova tentativa fora da recuperação custa crédito. Só com autorização explícita do Matheus: `autorizar-tentativa --id ID --item ITEM --motivo TEXTO --autorizacao "quem e quando" [--duracao 4|6|8]`, uma por item. Trocar o modelo de uma tentativa ainda não tem comando comum: relatar e pedir a decisão, sem script próprio.
- **Refazer com outro gerador:** `executar --id ID --gerador flow --creditos N --gerar sim --nova-versao sim` guarda a versão anterior em `producao/<run>/`, sem tocar em clipes nem posts.

## Limite do pedido

Resolver quem gera imagens, quem gera vídeos e onde parar. Respeitar o limite expresso; perguntar somente quando o pedido deixar essa divisão indefinida. Não pedir editor ou orçamento de vídeo se o pedido termina na preparação ou nas imagens.

| Cenário solicitado | Entrega e ponto de parada |
|---|---|
| Gerações 100% manuais pelo usuário | Coletar/analisar e entregar vídeo original, legenda, frames e identidade aplicável, prompt geral autossuficiente para ChatGPT com blocos por imagem e anexos em ordem, mais prompts individuais Veo com duração. Prompts integrais no chat e arquivos para baixar. Não gerar novas imagens nem enviar ao Flow. |
| IA gera somente imagens; usuário faz vídeos | Preparar e gerar imagens no provedor escolhido, salvar/nomear e entregar imagens finais + prompts de vídeo. Parar antes de qualquer geração de vídeo. |
| Usuário gera imagens; IA faz vídeos | Preparar o pacote manual; depois receber/vincular as imagens externas e autorizar somente a continuação aos vídeos dentro do teto. Parar após coletar clipes, se esse for o limite. |
| IA produz até os clipes | Gerar imagens e vídeos, coletar e organizar. Imagens Flow exigem aprovação humana; imagens prontas liberam seus vídeos. Entregar clipes e manifesto de edição. |
| Pedido inclui edição final | Continuar como tarefa de edição em FFmpeg/OpenCut e validar o vídeo final. O fluxo integrado atual entrega o manifesto; não afirmar que a montagem final está automatizada ou concluída por existir esse arquivo. |

**Só os shots usados:** gerar, entregar e subir somente as imagens iniciais distintas do plano final de produção. Vários shots de react/selfie/talking head podem apontar para a mesma base; aplicar a regra de reutilização em `../prompts-imagem/SKILL.md` antes de gerar. Takes são evidência; não gerar uma imagem/clipe por take automaticamente, nem escolher sempre `.1`. A cadência decide os grupos antes das imagens. Troca executável de utensílio no mesmo cenário pode ficar no mesmo shot; mudança de cenário ou reset físico incompatíveis com a continuidade observada e a câmera planejada exigem corte de montagem/shot próprio ou camadas separadas, sem transportar a personagem por morfose. Um deslocamento contínuo observado, com câmera acompanhando e dentro do preset, pode permanecer no mesmo shot. Quando esse corte usar um take interno, ele passa a ser origem de um shot necessário, não um extra decorativo. Registrar a justificativa e entregar somente a seleção final; preservar os demais frames no acervo de análise.

**Imagens somente:** a fila autorizada com `--gerar sim` também libera vídeos dependentes; não usar esse modo quando o usuário pediu parada nas imagens. Preparar com `manual --gerar nao`, usar os prompts ChatGPT do pacote e chamar a ponte `bun app/InstagramReferenceHub/scripts/chatgpt-image.ts /request.json /pasta-de-saida` por imagem (request contém `prompt` e `inputs[{path,sha256,role}]`). Receber os resultados pela CLI sem autorizar vídeos. Se o provedor escolhido for Flow, usar o controlador somente para a fase de imagens. Esses limites são procedimentos do agente; o seletor de gerador da UI não constitui um seletor de todas essas modalidades.

## Executar e retomar

1. `bun <CLI> contexto --ref REF --expert SLUG` resolve o personagem exato. Se faltar avatar, oferecer os personagens cadastrados e aceitar um ou vários. `preparar --ref REF --experts SLUG,SLUG` enfileira cada destino sem esperar a análise anterior. Importação, originais, legenda, nomes e análise permanecem na entrada `reference-hub`; não criar outro download/roteiro paralelo.
2. `bun <CLI> executar --id REF--SLUG` consulta a fila e os prompts integrais. Retomar os arquivos/decisões existentes. Não repetir Watch, leituras visuais, transcrição, aprovação ou auditoria por mudar Claude/Codex. Fonte ou configuração alterada exige corrigir a etapa afetada, preservando as tentativas já enviadas. O campo `nextAction` decide o passo, dentro do limite do pedido:

   | `nextAction` | O que fazer |
   |---|---|
   | `receber_imagens` | Passo 8 |
   | `autorizar` | Passo 4, se o pedido autorizou gerar; senão, parar e informar |
   | `executar_fila` | Nada: a fila trabalha. Não repetir comandos nem esperar render |
   | `aprovar_imagens` | Passo 6 |
   | `aguardar_coleta` | Nada: a fila coleta sozinha por até 15 min |
   | `coletar` | `coletar --id ID`; ausência depois disso segue a regra de envio incerto |
   | `resolver_erro` | Ler `jobs[].error` e o `REGISTRO.md`. Preparo sem envio volta com `executar --id ID --gerar sim`; causa no setup interrompe o lote; corrigir a causa com teste e retomar o mesmo estado dentro da autorização |
   | `editar` | Passo 9 |
3. Sem gerador escolhido, perguntar uma vez: prompts manuais, ChatGPT ou Nano Banana no Flow? Escolha já dada no pedido permanece válida. Resolver também teto Flow do trabalho e editor FFmpeg/OpenCut; não escolher outro expert/voz ou provedor para contornar uma falha.
4. Criar/retomar pelo mesmo endpoint da UI:

       bun <CLI> executar --id REF--SLUG --gerador chatgpt --creditos LIMITE --gerar sim --editor ffmpeg

   `--gerador flow` usa Nano Banana; `manual --gerar nao` prepara pacote sem gerar. Produção existente retoma com `executar --id REF--SLUG --gerar sim`; `--creditos` troca o teto e, sem ele, o teto gravado continua. `--gerar sim` expressa a autorização já recebida, não exige uma nova pergunta quando o usuário a deu. O controlador respeita a cotação real e o teto. Um novo pedido com gerador diferente não muda silenciosamente um trabalho em andamento.
5. **Claude → ChatGPT:** o backend chama `scripts/chatgpt-image.ts`, que executa `codex exec` autenticado com `image_gen.imagegen` nativo, prompt completo e anexos com hashes. O Claude chama a CLI acima, não precisa abrir ChatGPT no navegador. Sem Codex autenticado/ferramenta nativa, registrar o erro e preservar o pedido; não substituir por Higgsfield/API. A ponte valida o arquivo da sessão e reutiliza recibo íntegro, evitando geração duplicada.
6. **Imagens Flow:** a coleta coloca `pending_review`. Mostrar as imagens pendentes e pedir aprovação/reprovação uma vez. `aprovar-imagem --id ID --item STILL01[,STILL02]` aceita o hash atual e libera os vídeos dependentes automaticamente. `reprovar-imagem --id ID --item STILL01 --motivo "..."` exige o motivo, preserva a versão anterior e gera outra tentativa com a correção. Não aprovar por conta própria nem pedir nova aprovação de vídeo para cada envio.
7. **Envios:** retorno `submitted` encerra a transação: a fila segue ao próximo independente, sem esperar render. O agente usa esse recibo e deixa inspeção da mídia para a coleta; não acrescentar checagem de navegador, captura de tela ou espera de render após o sucesso. Recuperação de item incerto pertence à fila, sem travar os demais. Uma aba continua serial; o render não ocupa a transação. A coleta é separada. Imagens prontas liberam seus vídeos sem esperar as outras imagens. Envios incertos são procurados no Flow com o plano/ID técnico da tentativa; coleta não gera nem cobra. Acompanhamento é local e limitado, sem agentes de polling e sem loop de reanálise.
8. **Manual:** entregar os prompts completos **no chat**, além do pacote da API e seus arquivos reais: vídeo original, legenda literal, frames, identidade quando aplicável e variantes ChatGPT/Nano Banana. Caminho local ou nome do expert não transfere contexto para chat web. Para receber a imagem externa: `receber-imagem --id ID --item STILL01 --arquivo /imagem.png`; o backend valida formato, renomeia, organiza e libera os dependentes conforme autorização. Não marcar gerado por existir um prompt/ZIP.
9. **Edição:** clipes coletados geram `producao/<run>/edicao/manifesto.json`, com ordem, camadas, falas, presets, hashes e editor escolhido. Usar FFmpeg ou OpenCut para montagem; react/fundo continuam faixas separadas. Pequenos acréscimos/omissões nas bordas são ajuste de edição aceito pelo Matheus, sem retake automático. Mudança material de conteúdo, identidade, inteligibilidade ou ação é outra condição. Clipe coletado não significa vídeo editado/aprovado.

Estado canônico: `library/replicacoes/<REF>/<slug>/producao-workflow.json`; tentativas em `producao/<run>/imagens/<STILL>/tentativa-NN/`; planos Flow imutáveis por item/tentativa em `GoogleFlowMCP/outputs/<REF>/<slug>/workflow-<run>/`. Consultar a mesma API no Hub/CLI; não editar JSON para aparentar progresso.

## Recuperações determinísticas

A ponte resolve o executável por `IRH_CODEX_BIN`, PATH ou locais conhecidos do Codex/ChatGPT, sem busca global pelo disco. Configuração explícita inválida falha com erro claro. O controlador fecha o editor da cena do projeto atual antes de selecionar a biblioteca/coleção; não fecha editor de outro projeto. Não redescobrir essas rotas pelo navegador nem reescrever comandos de lote em cada demanda. Reusar o plano antes de gerar imagens e manter envio e coleta separados.

### Falha explícita do provedor

`provider_refused` é resultado da tentativa, não renderização nem falha de download. O coletor associa motivo ao prompt completo e identificador exato sem clicar `Retry`. Preserve imagem, plano, orçamento e arquivos prontos; não reenvie automaticamente nem use `reenviar-item` para disfarçar intenção registrada como “nunca enviado”. Intenção nos eventos do `flow-run` permanece válida mesmo sem confirmação de envio. Recuperação que envolva geração segue a autorização e o limite vigentes, com nova tentativa registrada; mudança de identidade, prompt ou provedor não é consequência automática da recusa.
