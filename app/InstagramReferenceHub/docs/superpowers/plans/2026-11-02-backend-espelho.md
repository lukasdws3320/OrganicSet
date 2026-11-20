# Revisão de consistência backend/interface

Pedido: tratar o Hub como espelho das fontes, resolver divergências. Execução autônoma autorizada.

Áreas examinadas: publicação estúdio/lista/pipeline/calendário/fila, leitura carrosséis, persistência de status, consulta de métricas, atualização dos consumidores useApi e preferências locais. Filtros, abas e seleção são apresentação; status editorial pertence ao backend.

Correções:
- list/get replicação projetam resumo canônico das notas e ignoram POSTADO/Flow legados em perfis geridos.
- Normalização compartilhada de publicação entre posts e carrosséis; resumo de todas as publicações por pasta. Arquivados saem do quadro ativo; agenda e atraso do carrossel derivados no servidor.
- Erro de leitura de posts não ativa legado.
- useApi relê ao focar e a cada minuto com janela visível, inclusive alterações externas às telas.
- Consulta assíncrona de métricas relê publicação antes de escrever; mudança de URL/status retorna conflito e preserva edição posterior.

Validação: testes publication-state, publication-mirror, posting-queue, posting-api e perfis-vault. Build e typecheck; erro global preexistente Workflow.renamedFrom no teste production-workflow:79.
Sem migração ou reescrita dos dados editoriais, sem commit/push. Revisão independente dos pontos carrossel/fallback realizada.

Runtime recarregado pelo controlador; comparação real API replicações × posts: 42 replicações conferidas, zero divergências de publicação. Tela Produção abriu sem erros JS. Testes focados: 10 passaram nos módulos publicação/fila/API + 5 passaram perfis-vault isolado. Typecheck app/server/scripts passou; global continua erro preexistente citado. Revisão final corrigiu rótulo Agendado na ficha do carrossel. Testes posts legados continuam fixture com pasta anterior à migração Mini Chefs (fora deste patch).
