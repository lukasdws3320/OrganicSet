---
name: reference-hub
description: "Executar o processo do Reference Hub por chat ou UI: importar referência/link, coletar originais e legenda, resolver expert/avatar, preparar análise e prompts de vídeo, retomar produção ou entregar pacote de carrossel para ChatGPT/Claude web sem contexto local. Usar também para 'só o prompt', referência ainda fora do Hub, troca de IA e conteúdo orgânico ou pago."
---

# Reference Hub — entrada compartilhada

Fonte técnica única: app/InstagramReferenceHub. Ler AGENTS.md e docs/execucao-por-chat.md dessa pasta. A UI e a CLI são clientes da mesma API; os arquivos e o banco pertencem ao mesmo processo. O diretório onde a conversa começou não escolhe um workflow diferente.

## Resolver o pedido

1. Identificar referência, expert/personagem, alterações e etapa autorizada: preparar, gerar, revisar ou retomar. Um pedido de prompt para outro chat termina em pacote preparado; geração fica no destino pedido.
2. Rodar a CLI absoluta, de qualquer pasta:

       bun app/InstagramReferenceHub/scripts/hub.ts contexto

   Com trabalho conhecido: contexto --ref REF --expert SLUG. O resultado resolve identidade física/hash, mídia, legenda, estado persistido e pacotes existentes. Selecionar o personagem exato: vários avatares podem pertencer ao mesmo perfil. Falta real de identidade não se resolve herdando Bruno/Giovana ou adivinhando por nome.
3. Referência ainda externa: importar --url URL --expert SLUG; consultar importacao --id JOB até localizar ref_id ou erro. Reutilizar referência existente quando a importação indicar duplicata. Importação pendente/parcial não comprova originais completos. Recuperar falha pelo importador antes de explorar manualmente uma página; navegador só para uma necessidade concreta que a integração não resolve, pela skill `browser-harness` em aba de fundo.

## Vídeo

Após a preparação, geração/retomada/manual usam obrigatoriamente [execução compartilhada](../replicar-referencia/etapas/execucao/SKILL.md): mesma fila/API para Hub, Claude e Codex, ponte ChatGPT nativa, aprovação das imagens Flow e handoff FFmpeg/OpenCut. Consultar `executar --id REF--SLUG` antes de reconstruir uma etapa; o campo `nextAction` diz o próximo passo. Análise válida não é repetida ao trocar de IA.

Ler ../replicar-referencia/SKILL.md e os módulos aplicáveis. preparar --ref REF --expert SLUG --formato FORMATO --engine ENGINE usa a mesma fila do botão da UI. Consultar status --id REF--SLUG e producao --id REF--SLUG. Resposta aceita/enfileirada não é prompts prontos. A análise, cadência, frames, revisão e Flow permanecem nos módulos atuais; não executar o fluxo histórico dtcwinner em paralelo. Lotes pagos seguem autorização, orçamento e controlador existentes.

## Carrossel para um chat externo

Referência governa os slides; contact sheet governa a identidade; pedido governa as alterações. Registrar alterações literais num arquivo de direção e usar:

       bun app/InstagramReferenceHub/scripts/hub.ts pacote-chat --ref REF --expert SLUG --alteracoes-file /caminho/direcao.txt --assinatura @perfil

Assinatura vem do pedido ou do cadastro conferido, nunca do nome inferido. O agente decide pelo conteúdo/pedido se há substituição pelo expert: usar --identidade expert somente nesse caso; usar --identidade none quando a recriação não utiliza sua aparência. Registrar a decisão. O comando exige originais completos e legenda; contact sheet exata apenas quando a identidade do expert é necessária. Ele entrega ZIP versionado, originais numerados, IDENTIDADE separada, legenda original, PROMPT.txt e manifesto com hashes; não gera nem aprova as novas artes. O Hub mostra o pacote na ficha da referência.

Ler ../replicar-carrossel/SKILL.md. Entrega manual sempre inclui o prompt completo no chat, com anexos, além dos arquivos. Ler o prompt produzido contra as fontes e o pedido. Contexto cadastral não substitui leitura visual da contact sheet e dos slides quando há decisão visual. Uma criança na referência e a nutricionista do perfil são papéis diferentes; esclarecer o alvo com as fontes, sem proibir ou inserir personagem por conta própria. Mudanças editoriais/legenda solicitadas seguem o método e modelo da operação, preservando o original separado.

## Troca de ambiente e conclusão

- Claude Code/Codex/Hermes com ferramentas locais: usar CLI/API, ler os mesmos módulos e retomar pelos arquivos persistidos. Skills orientam; código valida e executa as transações.
- ChatGPT/Claude web sem conexão local: receber arquivos reais e prompt autossuficiente. Nome de expert, URL localhost, caminho do Mac e link para skill local não dão acesso a identidade ou histórico. Extrair o ZIP e anexar originais e IDENTIDADE com papéis separados. Adaptar ao limite real de anexos/geração do destino e registrar o último item concluído.

Concluir preparação somente com arquivos locais legíveis, quantidade/ordem conferidas, legenda coletada, decisão de identidade resolvida (inclusive dispensada), prompt sem dependência do histórico e ZIP reaberto. Informar preparado, gerado, revisado e aprovado separadamente. Resultado externo só entra como gerado depois de receber e conferir os arquivos; nunca marcar mídia pronta pela existência do pacote.
