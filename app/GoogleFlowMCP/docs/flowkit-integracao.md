# FlowKit — avaliação e integração aditiva, 23/10/2026

## Decisão

Usar `crisng95/flowkit` como referência principal para um transporte alternativo ao controlador de UI. Manter o MCP atual como interface do agente; FlowKit é um possível backend, não um motivo para criar outro MCP inteiro. O backend continua dependendo de Chrome autenticado e extensão. A integração local entregue nesta revisão é diagnóstico GET + exportação offline; ainda não executa gerações por FlowKit.

Fontes fixadas:

- Principal: https://github.com/crisng95/flowkit/tree/b09e783481d20bfeaf46f2fbcde08bf2b54c0a2a
- Alternativa: https://github.com/vutrunquan/flowkit/tree/0ad5ddf381a2e25823ac669cae217789921f32be
- Contrato: https://github.com/crisng95/flowkit/blob/b09e783481d20bfeaf46f2fbcde08bf2b54c0a2a/docs/OMNI_FLASH.md
- Implementação: `agent/services/omni_flash.py`, `agent/services/flow_batch.py`, `agent/services/flow_client.py` nos SHAs acima.
- Extensão: `extension/manifest.json`, `extension/background.js`, `extension/injected.js`.

GitHub identifica ambos como repositórios independentes (`fork: false`). Os quatro arquivos de transporte/extensão comparados têm hashes diferentes entre os dois; não tratar como cópias idênticas nem misturar arquivos. O principal possui revisão mais recente na consulta de 23/10. Isso orienta a escolha de referência, mas não comprova que funciona na conta local.

## O que melhora e o que permanece

| Tema | Controlador local | FlowKit inspecionado |
|---|---|---|
| Envio | Controles acessíveis da UI via Harness | REST local → extensão → RPC interno no navegador |
| Referências | Seleção de cards por nome e evidência | IDs de mídia enviados ao backend |
| Acompanhamento | Recuperação de cards e download | Recibo de operação/workflow e polling específico |
| Sessão | Chrome/perfil autenticado | Chrome/perfil autenticado e extensão |
| Duração Omni | Presets do plano | 4/6/8/10 segundos, 360p/720p |
| Voz de Bruno | Requer validar vínculo compatível na UI | Funções de vídeo examinadas não recebem referência vocal |

A vantagem provável é reduzir dependência de cliques e tornar acompanhamento/coleta mais estruturados. Não há evidência de que o transporte melhore a qualidade visual do modelo por si só. O suporte declarado como verificado pelo autor não foi reproduzido nesta máquina.

`skills/fk-import-voice.md` registra WAV para um sistema separado de narração/TTS. Não equivale a fixar timbre e sincronização labial em todos os vídeos Omni. Preservar o requisito de voz; não substituí-lo silenciosamente por narração externa ou descrição textual.

## Ponte local entregue

`scripts/flowkit_bridge.py` usa apenas biblioteca padrão e o validador existente de planos. Nenhum código remoto foi instalado ou executado.

```sh
python3 scripts/flowkit_bridge.py doctor
python3 scripts/flowkit_bridge.py export \
  --plan /caminho/plano.json \
  --state /caminho/media/flow-run.json \
  --output /caminho/novo-export-flowkit.json
python3 -m unittest discover -s tests -p test_flowkit_bridge.py -v
```

- `doctor`: GET `/health` e `/api/flow/status` somente em loopback; retorna campos permitidos, sem tokens ou respostas brutas de autenticação.
- `export`: valida fontes/hashes/durações com `load_plan`, exige estado do mesmo plano e projeto, preserva prompt literal e usa IDs exatos quando registrados. Cria arquivo novo sem sobrescrever planos/estado.
- Exporta First frame e Ingredients de imagem como contratos distintos. Fonte sem ID de mídia, exigência de voz e vídeo já enviado/incerto aparecem como bloqueios. O arquivo exportado não é uma autorização de envio.
- Esta CLI não tem comando de submit, não abre Chrome, não faz upload, não altera status do Hub e não consome créditos.

Validação: três testes passaram (saúde/autenticação sem vazamento, restrição a loopback, preservação de prompt/duração e bloqueio de voz/envio incerto). Consulta real a `127.0.0.1:8100/health`: conexão indisponível. Não há backend FlowKit local validado.

## Ativação futura do transporte

Instalar/ativar extensão seria uma mudança no perfil Flow usado pela produção; esta revisão não modifica esse perfil. O manifesto solicita permissões de scripts, requisições, abas e regras de rede, e carrega componentes de reCAPTCHA/hijack bypass. Não ativar o setup automaticamente nem copiar esses componentes para o controlador atual. Manter instalação/avaliação de permissões separada da produção ativa.

Para transformar a ponte em backend de geração: serviço local autenticado/saudável, suporte confirmado à voz requerida ou rota explicitamente acordada, cotação viva e teto, recibo persistido antes do polling, conciliação de timeout sem repetição paga, coleta por ID e teste isolado. Preservar `batch_operation` versus `batch_media`; não converter descritores. Nenhuma falha autoriza cair silenciosamente em outro modo/modelo.

MCP expõe ferramentas; CLI oferece comandos locais; CI normalmente executa testes. O pedido parece referir-se a CLI. Uma CI pode testar o adaptador com fixtures sem abrir sessão nem disparar geração paga; não resolve autenticação ou qualidade de voz.
