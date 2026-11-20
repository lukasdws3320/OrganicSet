# Local Flow Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline.

**Goal:** Reusar sessão Chrome Flow existente em MCP stdio e API loopback sem escolher conta errada.
**Architecture:** Adaptar somente conexão, guardas de diagnóstico e wrapper; manter core de geração upstream.
**Tech Stack:** Node, TypeScript, Playwright Core, MCP SDK.
**Spec:** docs/superpowers/specs/2026-10-21-local-flow-bridge-design.md

## Global Constraints
- Chrome existente; target explícito; loopback only; readOnly padrão; não gerar mídia; não ler cookies/credenciais.
- Sem commit/push/deploy; upstream pin 7825125dec2853e05a1091d91685afc6abd53852.

## Review Focus
- Aba alvo mudou/fechou: falhar sem fallback.
- Endpoint remoto/path inválido: recusar sem exibir URL privada.
- Outro dono na porta: recusar quando alvo/modo divergirem.
- Métodos mutantes via API continuam bloqueados mesmo sem tool MCP.
- CDP erro não vaza URL; wrapper mantém stdout exclusivamente MCP.

### Task 1: Conexão e seleção exata
Files: src/connection.ts, src/chrome.ts, tests/connection.test.ts.
Interface: endpointFromActivePort(text), validateEndpoint(url), findTargetPage(browser,targetId).
- [ ] Teste falha por módulo ausente (node --test tests/*.test.mjs).
- [ ] Implementar validação/seleção entre contextos e adaptar getBrowser/getFlowPage.
- [ ] Teste passa.

### Task 2: Read-only e coordenação
Files: src/access.ts, src/index.ts, src/server.ts, src/api.ts, tests/access.test.mjs.
Interface: READ_ONLY, protectCore(core), canRead(method), bridgeIdentity(); métodos mutantes sempre falham antes de executar.
- [ ] Teste falha sem módulo; implementar proxy, ocultar tools e guard API, health identity.
- [ ] Testes passam e npm run build passa.

### Task 3: Instalação e smoke
Files: scripts/flow-mcp-local.mjs, ~/.local/bin/flow-mcp-local, configuração privada.
- [ ] Wrapper valida configuração privada, relê socket em cada invocação e inicia stdio/API.
- [ ] npm ci --ignore-scripts; build; testes completos.
- [ ] Handshake + flow_status e API health sem geração; documentar resultados.
- [ ] Principal revisa diff completo; não criar agentes adicionais.

## Ruling após feedback humano
- WS direto deixou de ser arquitetura ativa porque cada conexão pode pedir nova depuração. Parent autorizou IPC de daemon existente exclusivamente, sem Chrome WS.
- Task1 conexão substituída por src/harness.ts com testes fakeIPC RED→GREEN.
- Task2 read-only/API/protocolo concluídos,13testes passam.
- Task3 wrapper IPC-only instalado; handshake MCP e health passaram, status detailed real expirou90s. Coordenador assumiu upload legado e pediu pausa de RPC UI; smoke real segue incompleto.
- Não commitar nem fechar workspace; revisão e diagnóstico pendentes.
