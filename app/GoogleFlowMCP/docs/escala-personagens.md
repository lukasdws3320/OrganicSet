# Escala de uma referência para vários personagens

O frame original é compartilhável. A unidade de produção é **REF + personagem/avatar + versão**. Nome do frame, nome do expert e texto da fala não são chaves de mídia. Um personagem ficcional usa o mesmo cadastro de produção de um expert; o slug identifica o dono dos arquivos, da voz e do projeto. Para avatares independentes do mesmo expert, usar vínculos de produção separados, preservando os anteriores.

## Contrato executável

`scripts/flow_identity.py` é o validador comum a todos os `load_plan`, inclusive o CLI e o MCP. Ele compara:

- expert/slug/avatar/REF da replicação com a identidade do plano;
- arquivo e SHA-256 do contact sheet, perfil e seleção de imagens;
- modelo, modo, voz e projeto do perfil com os valores efetivos do plano, inclusive ausência de voz;
- cada imagem selecionada com path/hash, take e hash do frame original;
- política de áudio com os pedidos de fala e voz.

Os hashes conferem integridade dos arquivos e os metadados conferem seu vínculo. Eles não reconhecem o rosto nem ouvem o áudio. A imagem escolhida continua precisando corresponder visualmente ao personagem. O nome do personagem é dado de execução; ele não é acrescentado à fala por automação.

Planos com contrato completo recebem uma cópia de upload em `outputDir/initial-images/` cujo nome inclui REF, slug e hash do conteúdo. O frame fonte e a imagem selecionada permanecem intactos. Uma nova versão com o mesmo basename recebe outro nome remoto. O ID anexado é confrontado com o ID observado na coleção do projeto correto.

## Áudio por personagem

O perfil `expert-flow-profile/v1` pode conter `audio`, copiado literalmente para novos planos pelo exportador do Hub:

```json
{
  "audio": {
    "mode": "generated",
    "voiceBinding": "required",
    "allowInvalidMention": false
  }
}
```

- `mode`: `generated`, `post-production` ou `silent`. Os dois últimos não pedem voz no Flow nem fala gerada nos shots.
- `voiceBinding: required`: exige uma voz explícita e um vínculo observável com ID exato no compositor. Menção inválida bloqueia antes do clique. Um card genérico `voice_selection` sem ID não satisfaz essa exigência.
- `voiceBinding: best-effort`: mantém a voz indicada, sem prometer que o modelo a aplicará. `allowInvalidMention: true` só é usado quando essa exceção foi autorizada para aquele personagem/trabalho. Nunca cadastrar a exceção só para fazer passar o lote.
- `voiceBinding: none`: o trabalho não seleciona voz. Se houver fala gerada, o timbre fica sem referência condicionante; isso precisa ser uma escolha explícita do perfil.

`voiceBindingVerified` informa se a menção de ID exato está ativa na UI. `voiceTimbreVerified` continua `false`: um chip ativo não comprova a voz ouvida. Menções de áudio não solicitadas e ingredientes de voz residuais bloqueiam, mesmo quando aparecem válidos no Flow.

Modelo/modo sem vínculo de voz observável não atende um pedido de timbre obrigatório. Registrar a limitação e escolher uma rota autorizada que a cumpra; não trocar para Omni, remover a voz ou usar narração externa silenciosamente. Duração, sotaque, prosódia, texto completo, música e identidade visual são avaliados nos clipes coletados. O registro `qualityReview` começa pendente; arquivo baixado não é aprovação de qualidade.

Planos antigos sem `audio` não ganham uma garantia retroativa. Continuam disponíveis para retomada individual. Perfis e planos em produção não são reescritos para inserir campos, pois seus hashes e estados precisam continuar válidos. Para nova produção, revisar o cadastro do próprio personagem e exportar uma versão nova.

## Fila entre personagens

Manifesto `flow-production-batch/v1`, com paths absolutos e hashes reais:

```json
{
  "schema": "flow-production-batch/v1",
  "maxCredits": 100,
  "jobs": [
    {"plan": "/pasta/personagem-a/REF/versao/plano.json", "sha256": "SHA256_REAL_DO_PLANO"},
    {"plan": "/pasta/personagem-b/REF/versao/plano.json", "sha256": "SHA256_REAL_DO_PLANO"}
  ]
}
```

O valor numérico acima é exemplo de schema, não preço nem autorização. O teto do lote deve cobrir a soma dos tetos dos planos. Cada plano preserva seu teto e sua cotação viva. Não inferir orçamento a partir da quantidade de personagens.

Para montar o manifesto com hashes atuais sem editar manualmente, usar o CLI no diretório do controlador:

```sh
./scripts/flow-control create-batch --output /pasta/lote.json --max-credits 100 /pasta/personagem-a/plano.json /pasta/personagem-b/plano.json
```

Esse comando valida todos os planos e cria um arquivo novo. Não altera os planos, não abre Flow e não envia geração.

Auditoria offline, sem preparar o compositor:

```sh
./scripts/flow-control run-batch --manifest /pasta/lote.json
```

MCP equivalente: `flow_audit_batch {manifest: "/pasta/lote.json"}`. Não há dependência de Chrome para essa auditoria. Ela exige os contratos completos de todos os trabalhos, rejeita projetos compartilhados por personagens diferentes, diretórios de saída iguais/aninhados, planos duplicados, imagem/voz trocada, estado de outro plano e orçamento agregado insuficiente. O erro no último personagem impede que o primeiro seja enviado.

Para a produção já autorizada:

```sh
./scripts/flow-control run-batch --manifest /pasta/lote.json --submit
```

`--limit N` limita quantos shots a chamada tenta enviar. Sem `--targets`, os personagens passam serialmente pela mesma aba, sem esperar cada render. Para concorrência, `prepare-batch-tabs` vincula abas isoladas e `run-batch --targets <arquivo> --workers N --submit` sobrepõe trabalhos com locks por target, preservando orçamento e intenções. Coleta usa um lock de downloads separado. O agente acompanha o processo, sem selecionar cards e configurar cada shot manualmente. Usar uma sessão de terminal para lotes longos; não colocar a fila paga sob o timeout de uma chamada MCP. Progresso compacto, coleta por rodízio e revisão por versão: [execução eficiente](execucao-eficiente.md).

O diário `<lote.json>.state.json` registra intenção antes de cada transação, plan hash, jobKey, número exibido, ID do shot e recibo. Interrupção ou exceção preserva `needs_recovery`, sem nova tentativa paga automática. Após coletar/reconciliar a mídia no `flow-run.json` original, a próxima chamada reconhece `submitted`/`available` e continua. Preparação sem nenhum envio pode ser recuperada após verificar o estado, sem inventar recibo.

Essa fila envia gerações. A coleta continua com o coletor existente, por plano/projeto correto. A fila não afirma render concluído, download concluído ou voz aprovada ao terminar o envio. A troca para Flow Kit pode reutilizar esse contrato; trocar de transporte não garante timbre ou identidade visual.

## Verificação desta alteração — 25/10/2026

Testes isolados usam 20 personagens fictícios, a mesma REF e os mesmos nomes de frames. Validam segregação de voz/projeto/contact sheet/imagem, troca indevida no vigésimo plano, colisão de saídas, orçamento global, nomes por hash, retomada e interrupção incerta. O transporte pago é simulado nesses testes. Nenhum lote real de 20 personagens foi gerado nesta alteração.
