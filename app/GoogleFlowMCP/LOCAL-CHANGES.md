# Alterações locais — 21/10/2026

Base: https://github.com/GTAI-1/flow-mcp, SHA7825125dec2853e05a1091d91685afc6abd53852. UPSTREAM.json preserva hashes. Dependências e integridades preservadas; somente metadata bin da raiz do package-lock alinhada à nova entrada. Metadata start/main/bin aponta para dist/control.js; start:experimental mantém dist/index.js.

O adaptador Playwright/IPC anterior permanece experimental (status real expirou90s). O caminho padrão é src/control.ts + scripts/flow_control.py, ações fixas pelo IPC do Harness conectado. Sem nova conexão Chrome. Entrada estável ~/.local/bin/flow-mcp-local; npm start usa o mesmo controlador leve. Não há endpoint cloud publicado.

Teste real: dois anexos; Nano Banana2.1; Omni1.1Flash4s720p9:16x1; download. Vídeo4,010s, H.264720×1280/AAC48k estéreo. Cotação0+7, teto10, sem reenvio. Usuário aprovou ambos. Manifesto em outputs/REF-2026-10-0003/smoke-2026-10-21/MANIFESTO.json.

FonteSHOT01 0–2,73s, dez palavras/3,2 =3,125s → presetHub4s. Whisper local reconheceu condensado até3,98s no gerado: não aplicar trim cego em2,73s. Exportador novo no Hub gera plano com fontes/hashes, anexos únicos, prompts e duração individual. Controlador por fases guarda progresso e intenção antes de clique, com aliases REF+SHA para evitar misturar frames de referências diferentes.

Codex/ClaudeCode: registro google-flow. Hermes/ClaudeDesktop: google-flow-control. Todos apontam para wrapper estável; backups privados preservados. Registro não comprova recarga de sessão de cliente aberta. MCP status real respondeu331ms; não anunciar todos os runners como testados em geração.

Sem commit/push/deploy/daemon ou mudança nos dados de produção do Hub. REST experimental em loopback8791 mantém token/bloqueio de escrita padrão; não anunciar como MCP remoto pronto.
