---
name: replicar-prompts-video
description: "Fabricar prompts de movimento, fala e áudio para Veo no Flow, respeitando formato, camadas e duração medida."
---

Ler [orquestrador](../../SKILL.md) antes desta etapa.

# Vídeo a partir de imagem inicial

Ler análise visual, formato e cadência. Usar o gerador por camada de `server/prompt-factory.ts`; o relatório de análise fica fora do prompt.

Frames é a preferência: anexar a imagem inicial selecionada e dirigir ação/progressão, câmera, fala literal e áudio. A imagem já carrega composição e acabamento. Definir 4/6/8s conforme opções observadas do modelo e medição da fala/ação, nunca pela duração de montagem isolada nem uma taxa fixa de palavras. Elements é exceção justificada por composição/referências e opções efetivas, não substituição silenciosa.

Descrever a voz da personagem em linguagem natural: apresentação infantil/adulta/idosa quando sustentada, projeção, dicção, ritmo e interpretação. Não inserir `@VOZ`, nome de expert como comando de voz ou voz cadastrada obrigatória. Vínculo técnico existente é configuração própria, não direção de interpretação nem prova de clonagem. O personagem de destino governa a voz; uma criança na fonte não infantiliza uma adulta.

Fala entre aspas, idioma explícito; áudio de voz seca isolada sem música. Para fundo sem locução, pedir sem fala/música e somente sons da ação quando pertinentes. Emoção descreve entrega vocal/expressão, sem pedir trilha animada. Ausência de música e consistência de voz exigem ouvir o resultado.

React + animação: gerar fundo e plate em jobs distintos; fundo sem fala por padrão e plate com a fala completa. Duração de montagem se ancora no comentário, com segmentos que podem ter fundo+plate ou só talking head. Registrar entrada/saída do plate e canto na edição. Nunca orientar o modelo a queimar o react no fundo.

Entregar prompts completos no chat em modo manual; vídeo enviado, renderizado, baixado, ouvido e aprovado são estados separados.

Para demonstração, dirigir causa visível → movimento → resultado verificável, mantendo o objeto em quadro até o resultado. Não substituir a ação por gestos de apresentação nem inserir silêncio final como fórmula. Não forçar olhar na lente quando a pessoa precisa acompanhar o objeto. No preparo, registrar divergência entre fala e imagem da fonte (ex.: fala limão enquanto já mostra chia); preservar essa divergência na réplica fiel, ou realinhar somente quando a adaptação estiver autorizada. Não inventar uma ação ausente para ocultar a divergência.

O gerador remove IDs de quadros da análise e deduplica eventos, preservando eventos complementares. `acao_geracao` registra a direção executável e `direcao_camera` resolve a câmera, sem impor “plano ininterrupto” a todo formato. Transformação exige estado inicial, mudança de material/forma e estado final explícitos; o teste deve conferir o destino e a quantidade transformada. Quando o usuário esclarece que a massa liquefaz, essa direção prevalece sobre uma hipótese anterior de apenas deslizar o bloco; registrar como direção do trabalho. Falha em transformar pode exigir rever o frame inicial ou um estado final condicionado quando o modelo/rota realmente suportarem, não aumentar o prompt indefinidamente.

Fala para geração em PT-BR: renderizar números por extenso e conferir concordância com o substantivo, inclusive quando a transcrição já trouxe palavras (uma colher, duas xícaras, dois ovos, duzentos gramas). Usar `server/numeros-fala.ts`; corrigir somente a representação oral e erros inequívocos de concordância, preservando quantidade, conteúdo e transcrição original/timestamps. Em substantivo ambíguo ou fora do vocabulário do renderizador, revisar a fala contextual antes do envio. Não converter palavras faladas em algarismos.

Em receitas, usar medidas na oralidade brasileira: “um litro e meio”, “duas xícaras e meia”, “meia colher”. Temperatura Celsius fica “cento e oitenta graus”; manter Fahrenheit explícito quando for a escala original, sem conversão silenciosa.
