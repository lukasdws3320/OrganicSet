# Publicação opcional — 28/10/2026

Pedido: marcar como postado sem exigir link ou data, buscar dados do link do post anexado e oferecer atualização manual por ícone.

Implementado: formulário com campos opcionais, data inicialmente vazia, edição posterior, marcação preservada sem URL/data. `registradoEm` separado da publicação real, sem inventar data. Consulta usa o postUrl da replicação, nunca a URL da referência. Coleta automática após salvar com link e botão RefreshCw com busy. Salva data fornecida pela plataforma, legenda/perfil e métricas disponíveis com fonte/data. Ausente=null. Falha não desfaz marcação nem apaga dados; concorrência relê URL; data manual não é sobrescrita. Remoção explícita de campo funciona e link alterado invalida dados anteriores. Correção do título Postado sem URL.

Testes RED→GREEN de marcação/remoção e integração: suíte completa 176 testes/26 arquivos passou; após ajuste final de precedência da etapa, 31 testes API/pipeline passaram. TypeScript e Vite build aprovados. Build mantém aviso pré-existente de chunk>500kB. Sem commit/push. Não foram alterados os posts do usuário para teste.

Revisão independente encontrou envio indevido de data preexistente como manual, remoção de campos ignorada e título incoerente sem URL: corrigidos e verificados. Consulta validada com coletor injetado; resposta real de rede social não foi usada como prova.

Runtime reiniciado pelo MarcolinoOS (processo gerenciado; sem kill por porta). Houve espera de liberação da porta fixa antes da nova partida. API 4317 confirmou novo contrato no item Giovana REF0004.

Limite de verificação visual: Browser Harness indisponível. Diagnóstico inicial daemon sem Chrome; Chrome aberto e tentativa de reconexão feita, mas retorno permission-blocked. mac-approve não encontrou prompt ativo. Nenhum navegador alternativo foi usado para validar páginas. Conferência visual final não concluída.

Confirmação posterior do Matheus: carrossel batatinha Giovana postado e V1/V2 dos vídeos MiniChefs postadas, recriações só depois. Registrado nas fontes e no Hub sem data/link inventados. Corrigido carrossel que exigia URL para respeitar publicacao=postado; teste RED→GREEN em perfis-vault, quatro testes e TypeScript aprovados.
