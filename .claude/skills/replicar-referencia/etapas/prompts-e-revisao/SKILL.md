---
name: replicar-prompts-revisao
description: Escrever prompts concisos e revisar imagens, fala, ação e áudio de uma replicação contra as fontes, sem transportar o relatório de análise para o modelo.
---

# Prompts e revisão

Ler `../../SKILL.md`, contexto, cadência e módulo de formato aplicáveis. Reutilizar o gerador comum; suas saídas são derivadas dos dados conferidos.

## Escrita do prompt

O relatório detalhado fica nos artefatos de análise. O prompt leva somente o que muda a geração: personagem/voz resolvida, fala literal, ação e estado final, câmera observada e áudio. Começar curto; acrescentar uma restrição específica quando a referência ou uma falha real exigir. Não impor teto universal de palavras ao prompt nem cortar diálogo para encurtá-lo.

Adaptar o prompt de vídeo ao modelo/modo escolhido no Flow, principalmente Veo 3. Em Frames, a imagem inicial selecionada já fornece a composição: dirigir movimento, ação, fala e câmera sem redescrever toda a imagem. Em Elements/Ingredients, explicitar o papel das referências quando necessário para a composição. Não colar sintaxe de slots de outra engine nem exigir menção de voz por hábito. Nano Banana e ChatGPT são opções de criação da imagem anterior ao vídeo, conforme a escolha do trabalho.

- Imagem inicial: frame correto + contact sheet da personagem, com autoridade clara para roupa/identidade versus ação/cenário. Manter rosto fora do quadro quando a referência tiver só mãos/objetos. Nomear a pessoa a substituir quando houver várias; não inventar outro corpo ou gesto.
- Vídeo falado: direção vocal curta da versão; idioma e fala literal; ação em uma ou duas frases; câmera quando relevante; áudio claro desde a primeira sílaba até terminar a frase. Não repetir identidade, áudio e naturalidade em blocos equivalentes. Um prompt não garante timbre ou ausência de música.
- Mudo/POV: instruir o comportamento da boca quando houver personagem; ação e câmera da fonte; áudio conforme a política do trabalho. A locução prevista fica fora da geração visual.
- Não inserir push-in, microtremor, sotaque, velocidade, emoção ou gestos genéricos por hábito. Preservar direções explícitas do trabalho. Preferências de um expert não são defaults dos outros.
- `direcao_voz` nova substitui o fallback histórico; não acumular direção calma com uma instrução acelerada. O campo gênero, isolado, não determina voz adulta.

## Conferência antes de ampliar o lote

A execução autorizada usa `../execucao/SKILL.md`. Revisão de saída ocorre após coleta e não bloqueia o envio de outros jobs independentes. Uma fonte/hash já conferidos são reutilizados em qualquer LLM; não iniciar uma nova rodada de vistorias por mudança de sessão. Pequenas palavras adicionais/ausentes nas bordas da fala são aceitas para ajuste de edição pelo Matheus (29/10/2026): registrar a nota, sem reprovação ou retake automático. Não confundir essa tolerância com autorização para trocar conteúdo, identidade ou ação.

Comparar imagem inicial com o frame e o contact sheet: identidade/roupa, enquadramento, mão-objeto, estado e elementos críticos. Comparar clipe com ação completa e fala literal; ouvir o início e o fim em velocidade normal e conferir sílabas, dicção, pressa/arrasto, abafamento, volume, timbre e fundo. ASR ajuda a conferir texto, mas não prova áudio bom. `ffprobe`/hash comprovam arquivo e duração, não qualidade.

Se o início estiver abafado ou palavras parecerem engolidas, registrar o sintoma observado e o trecho; investigar prompt, preset, arquivo, codec/fade e corte da montagem sem declarar uma causa só por suspeita. Preferir reparo localizado. Validar a saída nova antes de repetir o padrão no lote. Não cortar começo/fim automaticamente nem usar `atempo` para forçar encaixe.

Reprovar falha material mesmo quando a arte estiver bonita. Registrar separadamente: fonte conferida, imagem selecionada, envio, clipe coletado, revisão técnica, edição e aprovação humana. Concluído quando o resultado, e não apenas o prompt ou o arquivo, corresponde às fontes.

Registrar a revisão da versão final pelo contrato `flow-clip-review/v1` em `GoogleFlowMCP/docs/execucao-eficiente.md`: hash exato, shot, revisor/modelo/effort observáveis, data e exame de áudio/imagem. O auditor de entrega confere bytes e recibos; texto global sobre revisão não aprova retakes. Reutilizar um recibo somente quando o hash for o mesmo; versão nova volta à revisão. Atualizar cada entrega pronta sem esperar falhas de trabalhos independentes.

## Delegação

Cada executor lê a skill principal e os módulos aplicáveis à sua etapa a partir dos caminhos reais; um resumo no briefing não os substitui. O briefing fixa REF + expert + versão, arquivos de saída exclusivos, fontes, evidência já conferida e condição de conclusão. Reutilizar análise/artefatos válidos e encaminhar ao revisor só os novos hashes ou falhas concretas. Preservar modelos/esforços solicitados; nenhuma troca silenciosa para economizar.

Preparação/revisão podem ocorrer em paralelo com autorização. Envio e coleta repetitivos usam processos locais do CLI: uma aba por trabalho, transações serializadas naquela aba e downloads sob lock comum. Lotes e esperas longas ficam numa sessão de terminal; aguardar resultado/notificação em vez de spawnar agentes de polling ou consultar repetidamente o mesmo estado. Nome e esforço do modelo são parâmetros da chamada; relatar valores efetivos quando observáveis, sem presumir pela preferência global.

Fala para geração em PT-BR: renderizar números por extenso e conferir concordância com o substantivo, inclusive quando a transcrição já trouxe palavras (uma colher, duas xícaras, dois ovos, duzentos gramas). Usar `server/numeros-fala.ts`; corrigir somente a representação oral e erros inequívocos de concordância, preservando quantidade, conteúdo e transcrição original/timestamps. Em substantivo ambíguo ou fora do vocabulário do renderizador, revisar a fala contextual antes do envio. Não converter palavras faladas em algarismos.

Em receitas, usar medidas na oralidade brasileira: “um litro e meio”, “duas xícaras e meia”, “meia colher”. Temperatura Celsius fica “cento e oitenta graus”; manter Fahrenheit explícito quando for a escala original, sem conversão silenciosa.
