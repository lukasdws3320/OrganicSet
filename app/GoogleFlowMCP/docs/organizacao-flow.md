# Organização por expert e referência

Contrato de produção de 23/10/2026: um projeto Flow por expert/avatar, com seu nome exato; uma coleção interna por vídeo, nomeada pelo ID completo da REF. Os arquivos e as gerações daquele vídeo ficam na coleção. Reutilizar projetos renomeados pelo usuário e coleções existentes.

**Hierarquia plana:** todas as coleções de REF são irmãs, diretamente na raiz do projeto do expert. Antes de criar uma coleção, navegar pelo link Library até `/project/<id>` e confirmar essa rota; criar enquanto outra REF está aberta produz uma subcoleção. Ao selecionar uma REF, conferir também `data-depth="0"` e que seu item pertence diretamente à lista raiz de coleções. Nome, URL e miniaturas corretos não comprovam a hierarquia. O controlador bloqueia coleção aninhada e informa a necessidade de movê-la para a raiz, preservando seu ID e conteúdo.

1. Abrir o projeto existente no perfil Flow. `ensure-collection --expert '<nome exato>' --reference REF-AAAA-MM-NNNN --project https://flow.google.com/project/<id>` verifica nome/ID, cria somente a coleção ausente e entra nela. O resultado contém `collectionUrl`. Projeto divergente é erro; escolher o projeto correto, sem renomear outro expert para fazê-lo passar.
2. Imagens feitas pelo Codex: guardar originais e versão organizada por REF/SHOT/TAKE/STILL, manifesto com SHA-256 e mapeamento de reutilizações. `collection-upload <arquivos absolutos> --expert … --reference … --project …` usa a superfície pública de arrastar arquivos na coleção selecionada. MCP equivalente: `flow_organize_collection` com `paths`. Cada atribuição retorna `submittedGeneration: false`; não há geração de imagem no Flow.
3. Aguardar processamento. A UI pode manter a grade antiga; atualizar a mesma URL da coleção antes de concluir ausência. `collection-media` / MCP `flow_collection_media` lê IDs e carregamento das miniaturas. Conferir contagem esperada e nomes na visualização/picker. Registrar a URL, IDs, arquivos e hashes no manifesto local. Atribuição ao upload, criação da pasta ou presença na biblioteca global não comprovam pertencimento à coleção. Upload incerto exige reconciliação antes de reenviar.
4. Preparar e gerar vídeos dentro da mesma coleção, quando solicitado. Planos novos recebem:

```json
"organization": {
  "expertProjectName": "Bruno Goytacaz",
  "collectionName": "REF-2026-10-0002",
  "projectUrl": "https://flow.google.com/project/<id observado>"
}
```

`flow_plan.py` aplica esse contrato antes das fases inputs/image/video/submit. Planos históricos sem o campo continuam legíveis; para retomá-los, selecionar a coleção correta antes de usar a UI. Não reescrever um plano já enviado nem reutilizar seu diretório de estado para outra versão.

O exportador `InstagramReferenceHub/scripts/exportar-lote-flow.ts` inclui `organization` nos novos planos. Por padrão usa o nome do expert do Hub. Se o projeto existente já usa outro nome/correção, passar `--flow-expert '<nome exato>' --flow-project 'https://flow.google.com/project/<id>'`; isso preserva o projeto renomeado pelo usuário sem alterar o cadastro antigo do Hub.

O picker de ingredientes serve para anexar referências ao prompt. Um upload feito somente nele pertence à biblioteca do projeto e pode continuar fora da coleção; para produção organizada, usar a superfície da coleção e verificar a grade correspondente.

A voz expressiva anterior do Bruno continua vigente. O teste de direção vocal física não foi promovido ao padrão pelo usuário. Este ajuste organiza arquivos e destino; não altera falas, entonação ou modelo de vídeo aprovado.
