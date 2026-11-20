# Pasta de frames para Flow — plano de implementação

> Para execução nesta sessão: superpowers:executing-plans, passo a passo, sem commits. Revisão independente será solicitada pelo agente coordenador.

**Objetivo:** preparar automaticamente imagens locais por análise e abrir o lote no Finder pelo Reference Hub, evitando downloads individuais.

**Arquitetura:** `frames/` permanece como fonte canônica de todos os takes. `flow/imagens-base/` contém cópias independentes apenas das imagens iniciais obrigatórias, deduplicadas por still; `flow/manifesto.json` rastreia todos os shots/takes, caminhos, tempos e hashes. A pasta é renovada por staging e renomeação após segmentação e sob demanda para análises antigas. O backend seleciona os caminhos e executa `open` como vetor de argumentos, aguardando o resultado.

**Stack:** Bun, TypeScript, node:fs e React existentes. Sem dependência adicional.

**Especificação:** pedido do Matheus em 21/10/2026, nesta conversa: pasta por análise com shots/imagens já locais, botão que abre o Finder para arrastar o lote para Flow/Omni; manter fontes, prompts e status intactos.

## Restrições

- Dados em `library/replicacoes/<REF>/`; não tocar originais nem status.
- Interface PT-BR, nomes dos JPEGs iguais aos anexos dos prompts.
- Nenhum login ou geração paga faz parte desta feature.
- IDs validados; somente caminhos calculados pelo servidor; recusar escape por caminho ou symlink.
- Suporte Finder no macOS, erro explícito em outra plataforma/falha de abertura.
- Manter dirty/untracked alheio. Sem commit, push ou deploy.

## Foco da revisão

- Fonte ausente ou hash divergente interrompe preparação sem entregar lote parcialmente atualizado.
- Reanálise remove arquivos obsoletos do lote e troca manifesto junto.
- Stills compartilhados entre shots aparecem uma vez no lote principal e todos os usos permanecem rastreados.
- Caminhos absolutos, traversal e symlinks não permitem ler/escrever fora da referência.
- Abrir pasta informa sucesso apenas após comando terminar; testes injetam o launcher e não abrem GUI.

## Tarefa 1 — pacote local rastreável

Arquivos: criar `server/pacote-frames.ts`, `tests/pacote-frames.test.ts`.

- [ ] Escrever testes reais de filesystem para seleção principal, todos os takes, nomes/conteúdo/hash/manifesto, regeneração e erros.
- [ ] Rodar `bun test tests/pacote-frames.test.ts`: deve falhar por feature ausente.
- [ ] Implementar `prepararPacoteFrames(dir, ref)` e `abrirPastaFrames(path, options?)` com launcher injetável.
- [ ] Rodar teste direcionado: todos passam, sem GUI.

## Tarefa 2 — integração e interface

Arquivos: `server/segmentar.ts`, `server/replicacoes.ts`, `server/index.ts`, `web/src/pages/ReplicationStudio.tsx`, `web/src/pages/Replicacoes.tsx` se necessário.

- [ ] Teste de segmentação garante pacote automático; teste HTTP garante endpoint retroativo e validação de IDs/escopo.
- [ ] Criar pacote ao finalizar segmentação; endpoint POST para preparar e endpoint POST para abrir escopo `principais` ou `todos`.
- [ ] Botão ‘Abrir pasta de frames’ em Cenas/Produção; modal curto com lote principal e todos os takes, indicação de quantidade e caminho após preparação.
- [ ] Rodar testes, TypeScript e build. Preparar dados existentes sem reanalisar ou gerar mídia.
- [ ] Relatar evidências e diff restrito em `/tmp/hub-frames-report.md`, para revisão do coordenador.
