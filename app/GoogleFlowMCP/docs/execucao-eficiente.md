# Execução concorrente, espera e revisão

Fonte operacional compartilhada por skill, CLI e MCP. As melhorias corrigem as esperas de 26 e 27 minutos sem novo arquivo observadas em OW | Info Flow, em 26/10/2026. Não garantem tempo ou custo do provedor: reduzem polling por LLM, repetição de trabalho e espera sem decisão.

## Unidade e custo de sessão

Preparar cada REF/personagem com as fontes existentes e reaproveitar análise/imagens por hash. Publicar o artefato conferido assim que estiver pronto; agrupar os trabalhos prontos em lotes com teto autorizado, sem esperar correções independentes para revisar ou organizar os bons. A soma dos lotes e retakes continua dentro do orçamento da tarefa.

Usar os agentes pedidos para análise/criação e revisão de conteúdo. Processos locais cuidam de enviar, esperar e coletar. Um agente LLM não precisa ficar consultando status de 15 em 15 segundos nem outro agente precisa vigiar esse agente. Manter modelo/effort solicitados; economia não autoriza trocar silenciosamente o modelo. Reutilizar o revisor e enviar somente novos hashes/falhas concretas, em vez de repetir toda a análise a cada rodada.

O briefing informa REF + expert + versão, fontes confirmadas, arquivos próprios de saída, módulos da etapa e critérios de conclusão. Etapas já conferidas chegam como evidência, sem análise duplicada. O relatório completo fica em arquivo; a conversa recebe resumo e alterações relevantes.

## Envios concorrentes

Padrão desde 03/11/2026: a fila do Hub vincula um target em segundo plano por trabalho (`ensure-tab`), sempre no perfil Flow; renderização/foco são emulados sem trazer janela à frente ou rearranjar o desktop e sobe as imagens num drop só (`upload-images`). `FlowControl` confere a conta Ultra na página, não depende da aba em foco e recusa script avulso. Veo Lite só com 8 s indica conta errada.

O CLI existente faz a execução; não criar scripts temporários por lote. O lote é auditado integralmente por `run-batch --manifest <lote.json>` antes de tocar a UI. Perfis, identidade, imagens selecionadas, projetos e tetos continuam obrigatórios.

```sh
./scripts/flow-control prepare-batch-tabs --manifest /pasta/lote.json --output /pasta/abas.json
./scripts/flow-control run-batch --manifest /pasta/lote.json --targets /pasta/abas.json --workers 3 --submit
```

São exemplos para uma tarefa de produção já autorizada, não uma autorização de geração. Selecionar a concorrência conforme o pedido e a capacidade observada; aceita 1–9 processos locais, sem 1–9 novas sessões LLM. O padrão legado sem `--targets` continua serial e não espera renderização entre envios. Com abas isoladas, `--workers` permite sobrepor transações de trabalhos independentes. Shots de uma aba permanecem em ordem.

`prepare-batch-tabs` mantém o perfil já autenticado, cria abas do Flow e persiste os vínculos; retomada reutiliza esses IDs. Intenção de criação interrompida requer recuperar a aba existente, sem abrir cópias. Cada trabalho usa uma aba própria; a aba do coordenador fica separada. O lock por target é determinístico: nomes arbitrários de lock não liberam duas operações na mesma aba.

A fila grava intenção antes de chamar o executor existente, respeita os limites e nunca reenvia `submitted`, `available`, `uncertain` ou intenção não reconciliada. Um trabalho que falha aparece em `recoveryItems`; os independentes continuam. Mesmo em timeout de subprocesso, a intenção fica preservada. Downloads usam também um lock comum porque o Chrome compartilha a pasta de destino.

## Acompanhamento e coleta

```sh
./scripts/flow-control batch-status --manifest /pasta/lote.json
./scripts/flow-control collect-batch --manifest /pasta/lote.json --targets /pasta/abas.json --idle-seconds 300 --max-seconds 900
```

`batch-status` é local, somente leitura, sem prompts completos; `--detailed` acrescenta shots quando necessário. O MCP oferece `flow_batch_status` com o mesmo contrato. Ele não chama o navegador e não cria arquivos/locks.

`collect-batch` visita as abas em rodízio, com downloads protegidos. O prazo é por shot: baixar um clipe não reinicia o relógio do que está parado. Os valores acima são parâmetros operacionais iniciais, não um tempo garantido de renderização; ajustar com evidência do modelo/modo. Cada probe é limitado a até 60 segundos, dentro do prazo total. Ao expirar, o item vira uma necessidade de investigação/recuperação e deixa de consumir scans repetidos; outros shots continuam. A retomada usa os timestamps originais, sem reiniciar a espera ao rodar o comando de novo.

Para um único plano, existem `plan-status --plan <arquivo>` e `collect-plan --plan <arquivo>`. A coleta em lote escolhe o target de cada plano a partir do arquivo de vínculos. Os comandos de coleta não clicam em gerar e não repetem geração paga.

Executar coleta/fila longa no terminal com a sessão de processo retornada pela ferramenta; aguardar a notificação/resultado. Não envolver o comando em loops de shell `pgrep`, sleeps longos ou vários agentes de polling. O MCP tem timeout de requisição: operações longas não são despachadas por ele.

`recover_existing` significa evidência não resolvida. Conferir estado real do Flow, projeto/coleção, prompt e resultados existentes. Não é prova de cobrança, filtro de segurança ou falha definitiva. Erro de coleta também não é erro de geração. Retake exige motivo observado, recuperação da tentativa anterior e orçamento vigente; usar outra versão de plano/diretório.

## Entrega e revisão vinculadas à versão

O revisor registra junto a cada clipe a evidência da versão que de fato examinou:

```json
{
  "schema": "flow-clip-review/v1",
  "shot": "SHOT01",
  "sha256": "HASH_DO_CLIPE_EXAMINADO",
  "status": "approved",
  "reviewer": {"model": "MODELO_EFETIVO", "effort": "high"},
  "reviewedAt": "2026-10-27T03:00:00Z",
  "audioReviewed": true,
  "visualReviewed": true
}
```

`approved` registra a avaliação do revisor, não aprovação humana nem garantia de timbre. Os booleans são uma declaração do revisor e só podem ser preenchidos depois de examinar áudio/imagem. ASR/hash/ffprobe não substituem essa revisão. Identificação do modelo vem da chamada observável; não inventar nome/effort para fazer o recibo passar.

A seleção contém `ref`, `expertSlug`, `expectedShots` (lista do plano atual) e `clips`. Cada clipe leva `shot`, `file`, `sha256`, proveniência e, quando feita, `review`. O mesmo hash é reutilizável se o mesmo conteúdo já foi revisado; outro retake precisa de outro recibo. Recuperar relatórios existentes e importar recibos quando a versão examinada, seu hash e o revisor forem comprováveis; ausência de recibo padronizado não exige refazer toda a análise anterior. Pendências sem lastro continuam explícitas. Não declarar “Opus por clipe” globalmente como substituto.

```sh
./scripts/flow-control build-delivery --selection /pasta/selecao.json --output /pasta/entrega-v2/manifesto.json
./scripts/flow-control audit-delivery --manifest /pasta/entrega-v2/manifesto.json
```

O builder não sobrescreve manifestos. O auditor e o MCP `flow_audit_delivery` verificam bytes e revisão por clipe, informam arquivos ausentes/alterados e revisões pendentes. Sem `expectedShots` completo, a cobertura não é comprovada. `complete` exige cobertura e revisão de todos os clipes. Uma entrega parcial conserva o trabalho bom e as pendências explícitas. Manifestos antigos seguem acessíveis; alegações legadas em prosa não aprovam retakes.

O Hub expõe `reviewStatus` separado de `status: baixado`. Essa distinção não apaga arquivos nem transforma uma revisão automatizada em aprovação humana.

## Ativação

Skill canônica é compartilhada pelo symlink já existente; sessões abertas precisam reler as instruções. CLI lê Python atualizado na próxima chamada. MCP stdio usa `dist/control.js`: compilar com `npm run build` e reconectar na pausa adequada para atualizar o inventário. A interface/API do Hub exige recarga controlada do runtime; o build da interface não reinicia o servidor. Não instalar outro plugin, MCP ou daemon para aplicar essas mudanças.


Coleta (04/11/2026): uma varredura por coleção atende todos os planos pendentes. O índice persistente em `~/.config/google-flow-mcp/state/collection-scans/` guarda o editor/prompt já observado e o resultado do download por asset; itens alheios, baixados ou com falha de download não são reabertos automaticamente. Renovação de query assinada não invalida a identificação do mesmo asset. A coleta não reproduz nem silencia o vídeo para baixar. Resultado coletado continua separado de revisão audiovisual.

### Recusas do provedor e coleta

O coletor de vídeos reconhece `flow-error-tile`, carrega somente `Reuse prompt` com compositor vazio, associa o prompt completo/tag à tentativa e limpa apenas o texto que carregou. Nunca aciona `Retry` ou `Delete`, nunca abre o editor para uma recusa e preserva rascunhos alheios. O índice privado limita releituras pelo conjunto de tentativas pendentes. Retorna `kind: provider_refused` com evidência; o executor do Hub registra erro definitivo da tentativa sem gerar novamente. Promessa de reembolso exibida pelo Flow não comprova crédito efetivamente devolvido.
