# Flow batch — fila sequencial, sem framework

**Rota atual para imagens iniciais já selecionadas:** [execução compartilhada](execucao-compartilhada.md), MCP `flow_execute_shot` / CLI `execute-plan`. Expert, avatar, contact sheet, projeto, voz e modelo vêm do perfil/plano. As seções históricas abaixo documentam a fila anterior; exemplos Omni e preferências de um expert não substituem o perfil do trabalho atual.

## Organização por expert e referência

Antes de upload ou geração, seguir [organização por expert e referência](organizacao-flow.md): projeto com nome do expert, coleção com ID canônico da REF, seleção verificada e manifesto local. Imagens geradas pelo Codex entram pela superfície da coleção; picker de ingredientes sozinho não comprova pertencimento. O controlador aplica `organization` dos planos antes da UI.

## Contrato de produção atualizado — Bruno / 21-10

- Análise da REF primeiro: SHOT é a geração contínua, TAKE é a mudança visual interna. O antigo limite universal de 24 palavras cortou incorretamente a REF-0001. O novo SHOT04 reúne 16,67–24,17s e 25 palavras em uma geração Omni de 10s; os seis estados visuais são TAKE04.1–04.6. Não usar os dois clipes históricos como resultado corrigido.
- Imagem: frame da própria REF + `contactsheetBruno01.png` em todo still. Fixar todo o figurino do Bruno e a cozinha quente com bancada clara. Pedir três candidatas se a cotação viva de imagem for zero; conferir e registrar qual foi selecionada antes do vídeo. Não assumir custo zero permanente.
- Modelo e voz: preferência atual de Bruno (23/10) é Veo 3.1 - Lite. Voz médio-grave, alta, projetada, muito entonada, empolgada e ágil, sem agressividade ou caricatura. Preservar a cor da imagem-base. Fixar referência de voz no Omni Ingredients quando disponível, testar um clipe com fala/rosto antes de escalar; a referência visual não fixa voz. A clonagem/dublagem local é rota de pós-produção, com validação de sincronização labial.
- Fila: importar só anexos ausentes sem abrir Finder; enviar imagens em sequência, revisar candidatas, depois enviar vídeos em sequência. Um executor UI por vez. Antes de cada clique pago, conferir ingrediente selecionado, texto integral, modelo, 9:16, x1, duração/preset, cotação e teto. Depois do envio, registrar intenção/resultado e partir ao próximo. Timeout: recuperar resultado existente; nova tentativa controlada segue a autorização vigente no `AGENTS.md`.
- Coleta: identificar pelo prompt integral, baixar Original size, verificar hash, duração/áudio, empacotar por REF. Mídia anterior e estados de planos ficam versionados; correção marca só o novo item pendente. `feito` significa arquivo presente e verificado, não aprovação do cliente nem vídeo editado.

Persistir `flow_batch.py` ao lado de `flow_plan.py` e `flow_control.py`, na pasta `scripts/` do GoogleFlowMCP. Os imports usam somente a pasta do próprio arquivo. Não executar o arquivo em `/tmp` contra a UI: seus módulos irmãos precisam estar instalados na mesma pasta.

```sh
python scripts/flow_batch.py queue-images /caminho/plano.json --inputs
python scripts/flow_batch.py queue-videos /caminho/plano-selecionado.json
```

Usar o Python do ambiente Browser Harness já instalado. A invocação da fila pressupõe a autorização humana vigente para o plano e seu teto cumulativo; não concede orçamento novo. Imagens exigem cotação observada de zero créditos. Vídeos usam a cotação lida do snapshot de preparação e a conferência integral já feita pelo `flow_plan`.

`--inputs` importa somente os aliases ausentes antes da fila de imagens. Se o upload continuar pendente, a fila para; uma nova execução recupera os inputs pelo estado, sem enviar gerações prematuras.

O arquivo usa o mesmo lock de `flow-control`, um executor por vez. Usa o Harness default e o alvo configurado. Se a conexão cair durante a tarefa autorizada, recuperar o mesmo Chrome/perfil/projeto conforme os invariantes de `AGENTS.md`, sem duplicar controladores nem refazer envios incertos. Não drena eventos nem usa endpoints privados.

Antes de preparar um item, recupera o estado local. `available`, `submitted`, `submission_intent`, `uncertain`, `blocked` e `failed` são pulados. Um arquivo disponível ausente/adulterado continua pulado e é reportado como necessitando recuperação; não se regenera. Um item `prepared` pode ser preparado novamente antes de seu primeiro envio.

A fila fecha editores por `Done editing` / `Done editing scene`, aguardando a volta à grade. Somente uma falha conhecida de renderização/preenchimento durante preparação permite uma repetição de preparação, antes de qualquer envio. Erros de fonte, seleção, hash, orçamento, modelo e cotação não recebem retry.

O envio ocorre fora desse bloco de retry, uma única vez, pelo `flow_plan`: prompt literal, referências exatas, modelo, modo, aspecto, count, preset, resolução, prova de seleção entre três candidatas e teto cumulativo são conferidos pelo módulo existente. Timeout/falha de envio encerra a fila; o estado `submission_intent`/`uncertain` deve ser recuperado, preservado no histórico. Nova tentativa usa plano/estado separado e a autorização de recuperação vigente no `AGENTS.md`.

A saída JSONL registra itens enviados, pulados, cotação, duração, quantidade e recuperação necessária. A fila não baixa mídia, não aprova resultados nem marca status do Reference Hub. Coleta e revisão visual continuam em etapas separadas.

Coleta dos vídeos existentes, sem gerar novamente:

```bash
python scripts/flow_collect_videos.py /caminho/plano.json --cycles 3
```

Aceita vários planos em ordem de prioridade (o último que declara um shot substitui o anterior). A coleta usa o prompt completo literal para identificar o clip, baixa 720p Original size, valida com ffprobe e registra o arquivo e SHA-256. A fila e a coleta usam o mesmo lock. Manter o Flow em inglês (`?hl=en`) para os controles observados. Se o Chrome recriar a aba, verificar o novo target com Target.getTargets no daemon existente e reassociar essa mesma aba; recuperar a conexão conforme `AGENTS.md` quando necessário, preservando a sessão e os envios existentes.

## Correção de envio — 23/10/2026

O retorno do clique indica somente que a ação foi despachada, não que o servidor criou uma geração. `flow_plan` agora espera o compositor limpar antes de marcar `submitted`; texto mantido vira `uncertain`, interrompendo a fila com estado correto. O controle de geração foi alterado de coordenadas para ativação do nó acessível exato; com esse caminho, SHOT03–12 foram aceitos, renderizados e baixados. A causa exata da perda do primeiro clique do SHOT02 não foi comprovada; falha do caminho por coordenadas é hipótese, não diagnóstico de servidor. Pesquisas e coleta não acharam o resultado. Próximas recuperações seguem a autorização no AGENTS, preservam tentativas antigas e reconciliam eventual duplicata.

## Áudio sem trilha — teste de 23/10/2026

O usuário identificou música em resultados apesar do fechamento “Sem música de fundo ou efeitos sonoros. Apenas a voz.”. Novo bloco canônico no gerador do Hub pede fala seca/isolada, fundo silencioso inclusive nas pausas, energia apenas vocal e exclusão explícita de trilha, instrumentos, batida, melodia, canto e SFX. Um piloto SHOT03 de 6s foi autorizado/enviado, com mesma imagem, fala, modelo e menção de voz; manter lote anterior até avaliação do novo resultado. Não tratar instrução textual como garantia de áudio sem música.

Resultado do piloto: o teste A com lista ampliada de exclusões ainda teve música segundo análise Gemini. Teste B com prompt compacto e direção positiva de voz isolada/fundo silencioso teve ausência de música segundo a leitura automática; frase concluída. Não é prova causal de que mencionar música induz música: também houve compactação do prompt. Padrão canônico atualizado para descrição positiva. Aguardar avaliação auditiva humana; não refazer lote inteiro automaticamente.

Avaliação humana posterior: Matheus identificou música baixa no teste B; o negativo automático de Gemini estava errado. Priorizar escuta humana, sem declarar ausência com base apenas no classificador. Novo piloto único com direção vocal física, sem generalizar descritores de clima do vídeo. Usuário usará lote atual; só aplicar alterações futuras após teste e avaliação.
