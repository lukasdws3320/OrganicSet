# Execução compartilhada no Flow

Procedimento canônico para Claude, Codex e outros agentes. Expert, avatar, contact sheet, REF, projeto, voz e modelo são dados de entrada. O controlador executa as mesmas etapas para todos. Para concorrência, espera limitada, custo de sessão e revisão por hash, ler [execução eficiente](execucao-eficiente.md).

## Dados por expert e trabalho

- Cadastro do Hub: nome do expert, slug e nome lógico do avatar em `replicacao.json`.
- Perfil do expert: `InstagramReferenceHub/library/experts/<slug>/producao.json`, schema `expert-flow-profile/v1`.
- O perfil contém `expertSlug`, `expertName`, `avatarName`, `contactSheet.path`, `contactSheet.sha256` e `flow`: nome/URL do projeto, modelo, modo, proporção, resolução, count e voz opcional.
- Voz mencionada, quando configurada: `voiceMention.id`, `display`, `option` e autorização daquela menção. Voz anexada em Elements/Ingredients, quando suportada: `voiceOption`. Ausência de voz permanece ausência; a voz de outro expert nunca preenche esse campo.
- Trabalho: plano vinculado em `library/replicacoes/<REF>/<slug>/flow-producao.json`. O plano fixa as fontes, imagens e orçamento daquela execução. Estado em `outputDir/flow-run.json`.
- Novos trabalhos ficam em `GoogleFlowMCP/outputs/<slug>/<REF>/<versao>/`. Diretórios históricos continuam válidos; preservar seus estados.

Para repetir uma referência entre vários experts/personagens, seguir `escala-personagens.md`: a checagem de todos os planos acontece antes de qualquer envio. `flow_identity.py` também compara o conteúdo do perfil/manifesto com o plano, além dos hashes.

O perfil pertence ao expert; a referência e a revisão de cadência pertencem ao trabalho. Não alterar um plano com envios existentes para trocar de expert, avatar, voz ou revisão.

## Primeiro cadastro de um expert

1. Ler o expert da replicação, conferir o avatar cadastrado e vincular o arquivo real do contact sheet. Guardar o arquivo em `library/experts/<slug>/`, com SHA-256. O nome lógico do avatar pode diferir do nome histórico do arquivo, mas o vínculo no perfil precisa ser explícito.
2. Reutilizar o projeto Flow já registrado. Se o expert ainda não tem projeto, ir ao início do Flow, usar o controle visível de novo projeto e renomear para o nome escolhido para esse expert. Registrar a URL raiz retornada e o nome exato no perfil. A criação do primeiro projeto é uma etapa de cadastro assistida pela UI; o executor não inventa IDs nem cria um projeto para substituir um vínculo ausente.
3. Conferir na UI a opção exata de voz, se houver voz definida para esse avatar. Registrar no perfil desse expert. Descrição de timbre e menção inválida não comprovam clonagem nem aplicação da voz.
4. Exportar no Hub com `scripts/exportar-lote-flow.ts --id <REF>--<slug> --output <arquivo-base> --credits <teto-autorizado>`. O exportador lê o perfil e valida identidade/hash do contact sheet. `--avatar` só é necessário na compatibilidade sem perfil, com nome correspondente ao cadastro.

## Imagens e cadência antes do vídeo

Para criar uma imagem, usar o frame do take da própria REF e o contact sheet do perfil. Seguir o provedor pedido e o estilo do avatar. No vídeo Frames, a imagem inicial já pronta é o anexo; não adicionar o contact sheet como segundo frame por engano.

Após selecionar as imagens, registrar um manifesto `flow-selected-images/v1` com:

```json
{
  "schema": "flow-selected-images/v1",
  "ref": "ID da referência deste trabalho",
  "expertSlug": "slug deste expert",
  "avatarName": "nome lógico do avatar cadastrado",
  "contactSheetSha256": "hash do contact sheet do perfil",
  "images": [
    {"still": "ID da imagem inicial", "path": "/caminho/absoluto/imagem-com-REF.png", "sha256": "hash da imagem", "referenceTake": "ID do take original", "referenceFrameSha256": "hash do frame original", "selected": true}
  ]
}
```

Registrar a revisão de cadência com `ref`, `expertSlug`, `authorizedByUser`, `reviewedAt`, `voicePace`, `groups` e `postProduction`. Cada grupo informa `sourceShots`, `duration` e `reason`; grupos unidos também trazem `actionDirection`. Todos os trechos originais aparecem uma vez, na geração ou na montagem.

Usar o builder genérico `scripts/flow_reviewed_frames.py --base <export-base.json> --review <cadencia.json> --images <manifesto-imagens.json>` com o Python do Browser Harness. Ele deriva os takes das fontes, reutiliza as imagens selecionadas, preserva modelo/voz/orçamento do perfil e produz `plano.json`. Não usar os builders históricos de um expert como modelo de configuração para os demais.

## Retomar uma execução

1. Ler `GET /api/replicacoes/<REF>--<slug>/producao` no Hub. `number`/`label` são os números exibidos; `id` é o ID legado do arquivo. Escolher o shot pelo número de produção, não pelo número do trecho original.
2. Ler o estado local do plano. `available`, `submitted`, `uncertain` e `submission_intent` são retomada/coleta; não são pedidos de nova geração. A instrução mais recente do usuário define se o trabalho atual é só organização, upload, preparo ou geração.
3. Executar **uma transação por aba por vez**, preferindo o MCP `flow_execute_shot` para ações pontuais. Lotes concorrentes usam o CLI e vínculos de abas descritos em `execucao-eficiente.md`:

```json
{"plan":"/caminho/absoluto/plano.json","shot_number":2,"submit":false}
```

Sem o número, escolhe o próximo shot ainda não enviado. O padrão prepara e verifica; não clica em gerar. Na execução de um lote já autorizado, usar `submit:true` para enviar, respeitando o teto do plano.

Fallback equivalente, inclusive em uma sessão Claude cujo inventário MCP ainda não tenha o novo comando:

```sh
./scripts/flow-control execute-plan --plan /caminho/absoluto/plano.json --shot-number 2
```

Para enviar dentro da autorização vigente, acrescentar `--submit`. O CLI usa o mesmo lock e as mesmas verificações do MCP. Não usar Python do sistema para importar o Browser Harness; o executável `flow-control` já fixa o ambiente correto.

## O que a transação automatiza

1. Confere os hashes e o vínculo entre expert, avatar, REF e plano. Novos planos incluem o hash do perfil e do manifesto de imagens.
2. Abre o projeto registrado, verificando nome e ID. Preserva um rascunho ativo de outro projeto em vez de apagá-lo ao trocar de expert.
3. Ajusta o idioma operacional com `hl=en` na mesma aba, quando necessário. Um rascunho já aberto é preservado antes de qualquer recarga; reprepare apenas o item da tarefa conhecida após salvar sua evidência.
4. Reutiliza ou cria a coleção com o ID completo da REF diretamente na raiz do projeto. Confere nome, URL, profundidade zero e pai direto.
5. Em contratos completos, cria uma cópia de upload cujo nome inclui REF, slug do personagem e hash de conteúdo, mantendo os frames originais intactos. Localiza essa imagem inicial pelo nome completo naquela coleção. Se estiver ausente, envia o arquivo local e aguarda a mídia confirmada. Salva intenção de upload antes da operação para não duplicar arquivos após timeout.
6. Liga o ID da imagem da coleção ao still do plano; configura modelo, modo, proporção, duração e x1 conforme os dados.
7. Preenche o prompt literal, seleciona a menção de voz exata quando configurada no plano e anexa a imagem. Compara o ID anexado ao ID independente da coleção; uma imagem qualquer anexada não satisfaz a verificação.
8. Confere prompt, referências, voz, modelo, duração, resolução, count, cotação e orçamento antes do envio. Salva `<ID>.workflow.json`, `referenceProofs` e estado persistido.
9. Só com a opção explícita de envio registra intenção e clica uma vez. Prompt não limpo ou timeout vira envio incerto e exige recuperar a mídia existente antes de eventual nova tentativa autorizada.

`ready`/`willSubmit:false` comprova preparo. `submitted` comprova envio. Vídeo pronto exige coleta do arquivo, hash, duração/áudio e revisão. Recarregar o painel do Hub depois de coletar atualiza a visualização.

## MCP e conexão compartilhados

O Claude usa o servidor `google-flow` cujo launcher é `~/.local/bin/flow-mcp-local`; o código canônico é `GoogleFlowMCP/src/control.ts`, compilado em `dist/control.js`. Codex e o CLI usam o mesmo controlador Python e o mesmo estado. Uma atualização de inventário MCP só aparece na próxima conexão; o fallback CLI dispensa interromper a sessão atual.

Se a conexão cair: diagnosticar `browser-harness doctor --json`; recuperar o mesmo Chrome/perfil autorizado, reassociar a aba do projeto registrado e atualizar somente `targetId` em `~/.config/google-flow-mcp/connection.json`, mantendo os demais campos e modo 600. O AGENTS autoriza essa recuperação na tarefa vigente. Não trocar de conta nem criar outro perfil para contornar login/MFA.

## Cobertura de verificação

O smoke de 24/10 valida um projeto existente, uma coleção já existente, seleção de imagem pelo ID, prompt, menção e configurações até `ready`, sem nova geração paga. Os testes com dois experts sintéticos validam que identidade, contact sheet, projeto e voz não são herdados entre eles. A criação inicial de um projeto novo e uma geração paga de outro expert não foram executadas como parte desse smoke.

### Recuperação e tempos medidos (29/10/2026)

Novos exports podem trazer `timingEvidence`: transcrição com hash, faixa exata de palavras e segundos medidos. O controlador verifica fala literal, janela e hash antes de aceitar 4/6/8s no Veo; não substitui medição por 3,2 palavras/s. Voz adaptada precisa de medição própria ou revisão explícita.

O workflow registra o rascunho que preparou por target. Ao trocar de projeto, só limpa texto/referências idênticos a um envio registrado como submitted/available e com plano inalterado; outro rascunho permanece protegido. Prévia pode ser `<video aria-label="Generated video">`, além da miniatura antiga. O coletor abre o editor e confere prompt literal antes de vincular/baixar; ausência de `data-media-id` na prévia não significa ausência de clipe. Diagnóstico da coleta guarda causa redigida no output do próprio plano.
# Integração com a fila do Reference Hub (29/10/2026)

O Hub e qualquer LLM local podem chamar `InstagramReferenceHub/scripts/hub.ts executar`. O serviço persistido usa este controlador para projeto/coleção, anexos, prompt, configuração, cotação, submissão e coleta. Uma transação espera confirmação do envio, nunca a renderização anterior. Imagens Flow coletadas aguardam decisão humana; a aprovação libera imediatamente seus vídeos dependentes. Reprovação com motivo cria tentativa nova, preservando plano e arquivos anteriores.

Planos novos da fila levam `submissionTag` por REF/avatar/run/item/tentativa no prompt efetivamente enviado, para distinguir imagens/reacts com prompts e composições semelhantes. `scripts/flow_collect_videos.py --kind still` reutiliza o coletor de originais, requer esse identificador e mantém aprovação pendente. Legado sem tag continua por ID de asset explicitamente observado. O padrão `--kind shot` preserva a coleta anterior de vídeo. Coletor nunca reenvia geração. Envio incerto continua na recuperação de saída existente, com prazo limitado e sem novo clique pago.

