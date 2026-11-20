# Fluxo direto de replicação — plano de implementação

> **For agentic workers:** usar execução por tarefas com teste antes de lógica e revisão independente. Não fazer commit, push, novo login ou geração paga neste trabalho.

**Goal:** transformar os passos comprovados no teste da REF-0003 em execução retomável, sem recópia de prompts e sem repetir geração por falha de leitura/download.

**Architecture:** o Hub exporta um plano imutável com fontes, hashes, anexos, prompts e duração por shot. O controlador existente consome o plano por fases, reutiliza arquivos/assets concluídos e registra cada submissão antes do clique. O navegador continua sendo o perfil Flow conectado pelo mesmo IPC.

**Tech Stack:** Bun/TypeScript no Hub; Python/Browser Harness e MCP stdio no controlador.

**Spec:** pedido do usuário de 21/10/2026: validar os 4 segundos e reduzir retrabalho com base no caminho já comprovado. A aprovação de execução e a dispensa de reconfirmações constam na conversa.

## Global Constraints

- Duração fonte, solicitada pelo Hub e efetiva no modelo são campos separados; nunca fixar todos os shots em 4s.
- Omni oferece presets 4/6/8/10 nesta sessão. Escolher o primeiro que comporte o plano, janela e fala; duração insuficiente ou acima do contrato bloqueia.
- Fala literal; não aparar automaticamente o vídeo gerado à duração da fonte.
- Um upload em lote apenas dos arquivos ausentes; anexos conferidos pelo conjunto exato.
- Um processo controla a sessão por vez. Nenhuma nova conexão Chrome, perfil, login, cookie ou API privada.
- Persistir intenção de submissão antes de clicar; timeout após clique exige recuperação, nunca novo clique automático.
- Plano e arquivos concluídos são reutilizados apenas com hashes correspondentes.
- Validação deste incremento sem novos gastos: testes de estados/erros, exportação real e preparo/retomada sobre o resultado existente.

## Review Focus

- Fonte de 2,73s, fala de 10 palavras e preset de 4s não podem virar duração literal igual à fonte.
- Colisão de nomes, arquivo alterado ou plano trocado não podem reaproveitar mídia errada.
- Arquivo local ausente após geração não autoriza cobrar de novo.
- Falha de quote, preset ou alvo impede submissão.
- O resultado deve distinguir mídia disponível de fala/ação aprovadas; ASR é indício, não aprovação humana.

## Tarefas

- [x] Hub: `server/lote-flow.ts`, `scripts/exportar-lote-flow.ts`, `tests/lote-flow.test.ts`. Exportar plano v1 a partir da fonte validada, sem alterar análises ou status. Testar presets, copy, seleção e deduplicação.
- [x] Controlador: reaproveitar `flow_control.py`; adicionar executor de fases e ferramenta MCP para plano, preparo e retomada. Testar falhas e idempotência com transporte falso; usar ações reais já comprovadas como adaptador.
- [x] Evidências: preservar imagem/vídeo e manifesto do teste; registrar duração fonte/produção/arquivo e limites de validação.
- [x] Conferência: testes apropriados uma vez após a última alteração, exportação real REF-0003, revisão independente e smoke de leitura/preparo sem nova geração.
