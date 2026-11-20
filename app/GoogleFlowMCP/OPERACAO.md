# Operação local

Execução eficiente (27/10/2026): procedimento atual em [docs/execucao-eficiente.md](docs/execucao-eficiente.md). `batch-status`/MCP `flow_batch_status` resumem sem navegador; `prepare-batch-tabs` e `run-batch --workers --targets` sobrepõem trabalhos independentes; `collect-batch`/`collect-plan` encerram esperas sem progresso; `audit-delivery`/MCP `flow_audit_delivery` exigem revisão da versão exata. Recompilar atualiza `dist/control.js`; sessões MCP abertas só recebem ferramentas novas na reconexão. CLI usa o Python atual na próxima chamada.

O caminho padrão é Flow Control: MCP stdio leve com operações fixas que reutilizam o Browser Harness default já conectado. Não usa Playwright, não consome event feed, não abre WebSocket Chrome e não pede nova depuração.

Executável permanente: app/GoogleFlowMCP/scripts/flow-control

Comandos:
- status: corpo visível limitado + controles AX + inputs de arquivo; não abre painéis.
- click --role button --name NOME_EXATO: AX→DOM box→clique.
- upload /caminho/frame.png /caminho/contactsheet.png: lote pelo input[type=file][accept*=image]; abrir Add ingredients to the prompt box antes. Não usar menu Upload que abre seletor nativo de arquivo.
- fill --prompt-file /caminho/prompt.txt [--selector SELETOR]: preencher e conferir texto sem enviar.
- key Escape: fechar overlay via teclado.
- screenshot --output /caminho/shot.png: salva viewport PNG.

Só aceita comandos enumerados; não há eval/exec/JS arbitrário/navegação. Imagens precisam existir em caminho absoluto e ter extensão/assinatura de imagem. A cada processo, require_existing_daemon faz health do daemon existente, configura BH_REQUIRE_EXISTING_DAEMON=1 e compara targetId exato antes de comando. Todos comandos de página usam session_id explícito. Não troca aba/conta nem cria nova sessão.

Aprovação persistente do executor pode usar prefixo exato do executável flow-control, evitando snippets Python/JS arbitrários em heredoc a cada operação.

Wrapper MCP ~/.local/bin/flow-mcp-local inicia dist/control.js por padrão e oferece flow_status, flow_import_images e flow_ui_action. --read-only oferece somente flow_status. Click de geração/envio e Enter ficam bloqueados por padrão; --allow-submit no CLI ou acknowledge_submission:true no MCP exigem autorização humana explícita da ação/custo. Nenhum retry automático. Importação atribuída ao input só é considerada concluída após conferir cards/status.

Config privada ~/.config/google-flow-mcp/connection.json (600), targetId Flow fixo, diretório700. controlReadOnly:true opcional bloqueia tools UI; readOnly:true controla apenas adaptador experimental anterior.

--experimental seleciona adaptador Playwright custom IPC (ainda não validado; status detailed anterior expirou90s). --api serve API/painel upstream experimental loopback8791, bloqueada por readOnly:true; não é MCP HTTP. 8787 pertence ao QuizTemplate. O caminho experimental consome drain_events e exige CLI ocioso; não usar por padrão.

Verificação até agora: CLI--help e3testes puros passaram; TypeScript build passou; handshake MCP em0.46s confirmou3tools padrão e1tool em read-only, sem leitura da UI. Status live aguardava exclusividade do coordenador; upload/geração somente coordenador. Nenhuma mídia gerada por este agente.
