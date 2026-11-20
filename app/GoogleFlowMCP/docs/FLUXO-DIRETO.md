# Replicação direta pelo plano do Hub

O agente usa `flow_run_plan` no MCP. O operador também pode usar `scripts/flow-control run-plan --plan /caminho/plano.json --phase <fase>`. O perfil Flow continua conectado pelo mesmo Browser Harness.

1. **Exportar uma vez:** no InstagramReferenceHub, `bun run scripts/exportar-lote-flow.ts --id REF--expert --avatar /contactsheet.png --output /lote/plano.json --credits 10`. Opcional: `--shots SHOT01,SHOT02` e `--version V1`. Plano novo, sem sobrescrever fonte/status.
2. **prepare:** valida hashes/fontes/duração e prepara anexos com nomes únicos REF+hash, prompts e estado local. Não toca navegador.
3. **inputs:** sobe o lote de anexos ausentes pelo input da página e verifica os cards concluídos. Quando um upload conclui depois da espera, reconhece o alias existente; não precisa enviá-lo novamente.
4. **image / video:** recebe `--kind still --item STILLxx` ou `--kind shot --item SHOTxx`. Configura modo/modelo/formato/count/duração, preenche o prompt e anexa referências. Apenas prepara. Um item já disponível retorna `reused:true` sem executar a geração.
5. **submit:** exige o item preparado, a cotação observada em `--quote`, `--submit-name 'Start generation'` e `--acknowledge-spend`, dentro da autorização humana já existente. Relê prompt, referências e settings; grava intenção antes do clique. `--check-only` faz todas essas conferências sem clicar nem reservar novo crédito.
6. **Coletar e registrar:** usar as ações de mídia do MCP para localizar/baixar o resultado existente e `record` para guardar arquivo, hash, ID e projeto exatos. Informe a cotação conhecida (`--quote 0` ou `--quote 7`, por exemplo), inclusive na adoção de um resultado anterior. Não reduzir a reserva já registrada. Download do vídeo usa a ação original da UI, sem upscale pago.
7. **status / recover:** mostram o ponto de retomada. Resultado incerto ou arquivo ausente exige recuperar a mídia existente; o script não cobra uma nova geração como tentativa de recuperação.

Os nomes dos itens vêm do plano: STILLs não são necessariamente consecutivos. A geração de SHOT02 desta REF usa STILL03, por exemplo. Narração em pós (`speechMode:post-production`) não deve ser cobrada como fala gerada. Não aplicar trim automático à janela original.

## Conferência real em 21/10/2026

- Plano REF-0003 completo:11shots,10stills,11anexos únicos; fonte/produção/preset separados por shot.
- Os11anexos foram enviados e confirmados na sessão existente. O contact sheet terminou após a espera inicial; a retomada reconheceu o arquivo pronto sem novo upload.
- STILL01 e SHOT01 foram adotados com seus hashes/IDs/projeto e cotação0+7. As chamadas seguintes retornaram reused:true, sem nova mídia.
- Preparo real de STILL03: modelo/formato/count, prompt e referência conferidos; aproximadamente0,8s em uma execução local. Não é benchmark de throughput.
- Conferência final de submit com check-only: ready, willSubmit:false, quote0, remainingBudget3, promptAndReferencesMatch:true e settingsMatch:true.
- MCP normal expõe flow_status, flow_import_images, flow_ui_action e flow_run_plan; read-only expõe só flow_status. Smoke real em docs/evidencias/flow-control-2026-10-21/flow-plan-mcp-smoke.json.
- Build e13testes Node passaram;17testes Python passaram;48testes do Hub e typecheck passaram. A revisão detectou casos de symlink/alias, cópia alterada e prompt/anexos trocados; foram corrigidos antes da entrega.

O único teste de geração concluído continua sendo o SHOT01 aprovado pelo usuário. Este incremento foi validado sem outra geração paga; não é prova de um lote inteiro renderizado automaticamente. O fluxo é por fases supervisionadas pelo agente, com retomada persistida; a coleta/record do resultado ainda usa as ferramentas de mídia, não um serviço cloud autônomo.
