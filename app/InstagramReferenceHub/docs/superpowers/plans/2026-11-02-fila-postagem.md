# Fila de postagem — plano

Objetivo: concluir as postagens de um horário sem alternar entre estúdio, calendário e pastas.
Autorização: Matheus pediu execução autônoma e delegou as decisões de organização.
Arquitetura: projeção de listarPosts/Postagens.md no backend, sem banco ou status paralelo. React consome a fila e PATCH existente confirma a publicação. Abrir Finder nunca publica.

- [x] Testar fila: horário → perfil → versões, atraso, bloqueio sem mídia, concluídos, próximo horário e data de São Paulo.
- [x] Implementar server/posting-queue.ts e GET /api/postagem/fila; manter posts em produção visíveis como bloqueados.
- [x] Resolver arquivo por post no backend e POST /api/posts/:id/revelar sem aceitar caminho do cliente.
- [x] Criar /postar: agenda do dia, seleção de horário/perfil, vídeo/slides, legenda, Finder, confirmação e avanço, desfazer, atualização por foco/poll.
- [x] Integrar navegação e acesso na Home; documentar uso em HTML autossuficiente.
- [x] Executar testes focados, typecheck/build, revisão independente e inspeção visual.

Decisões: o envio ao celular continua pelo Finder; o sistema não inventa envio nem publicação. Horários futuros são selecionáveis, mas não avançam silenciosamente para outro bloco. Sem mídia final, ação de publicar bloqueada. Fila mostra pendências anteriores separadas; variações permanecem posts independentes. Sem commits ou alteração deliberada das agendas existentes.

Verificação: 6 testes novos passaram (fila + API real isolada). Build passou. Typecheck de app/server/scripts passou; typecheck global bloqueado por tests/production-workflow.test.ts:79 (renamedFrom ausente no tipo Workflow). Suítes legadas posts/agenda falham fora desta alteração: fixture Cozinheiras ainda usa pasta anterior à migração Mini Chefs; agenda espera ausência de remarcação V2 após agendamento manual. Não corrigir escopo alheio. Revisão independente identificou e corrigiu avanço vencido, seleção durante gravação e confirmação repetida antes de GET.

Runtime: recarregado pelo controlador MarcolinoOS; /postar e /api/postagem/fila responderam. Navegador: desktop + mobile390px sem overflow, sem erros JS; confirmação simulada avançou Bruno→Mini Chefs→horário concluído sem mudar posts reais. Finder abriu arquivo final existente.
