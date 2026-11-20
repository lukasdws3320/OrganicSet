# Fluxo de produção compartilhado

**Objetivo:** a UI e qualquer LLM local usam a mesma fila e os mesmos prompts, arquivos e decisões. Edição em FFmpeg/OpenCut sucede a coleta; pequenos acréscimos de fala nas bordas são notas para edição.

**Arquitetura:** reutilizar importador, preparação, fábrica de prompts e controlador Flow. Acrescentar estado por replicação e tentativas imutáveis, ponte de imagens pelo Codex CLI autenticado e executor que separa submissão de coleta. Nenhuma nova análise de fonte válida ao trocar de agente.

**Spec:** pedido de Matheus nesta sessão, 29/10/2026: múltiplos avatares, prompts integrais no chat manual, ChatGPT via Claude, aprovação de imagens Flow, rejeição com motivo, vídeo automático após aprovação e envios independentes sem esperar render.

- [x] Testar transições, isolamento, retomada, rejeição com motivo e concorrência sem render anterior.
- [x] Implementar fila/API/CLI e arquivos com hashes por tentativa, sem sobrescrever planos pagos.
- [x] Implementar ponte Codex de imagens, dispatch/coleta Flow pelo controlador existente e aprovação na UI.
- [x] Atualizar módulos de execução e revisão, testar integração, typecheck/build e revisão independente.

Evidência: geração nativa real REF0200 e recuperação via Claude CLI; 4 planos reais (imagem/vídeo REF0193/0200) validados offline pelo controlador; aprovação/recebimento/CLI pela API real em biblioteca temporária; UI real desktop/mobile sem overflow. Nenhum novo lote pago Flow foi disparado para este desenvolvimento. Revisão independente encontrou falhas de submit-name, wake durante coleta, colisão de prompts e recuperação de uncertain; corrigidas com regressões. O handoff de edição prepara entradas para FFmpeg/OpenCut, não executa montagem final nem atribui aprovação de áudio.

Ruling: pedidos sem gerador definido retornam a escolha pendente; sem autorização de produção não há envio. Uma imagem Flow coletada aguarda aprovação humana; imagens ChatGPT seguem a autorização do trabalho. Falha incerta conserva tentativa e não dispara uma duplicata. Nenhuma troca de ferramenta silenciosa.
