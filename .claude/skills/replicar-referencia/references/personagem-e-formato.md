# Composição do trabalho

Cada replicação combina eixos independentes. A escolha de um formato não seleciona um personagem, uma velocidade de fala ou um modelo de vídeo.

| Eixo | Fonte | Responsabilidade |
|---|---|---|
| Objetivo | Pedido e decisões do trabalho | Preservar o conteúdo aprovado ou adaptar a estrutura dentro do escopo autorizado. |
| Personagem | Cadastro/replicação e perfil `library/experts/<slug>/producao.json` | Nome, avatar/contact sheet, referência de voz, identidade e restrições próprias. |
| Interpretação | Materiais do personagem e `copy.versoes[].direcao_voz` da replicação | Ritmo, volume, sotaque, entonação e léxico da versão atual. |
| Formato | `replicacao.formato` e módulo correspondente | Relação com a referência, presença em quadro, ação, câmera, fala em quadro/off e montagem. |
| Estilo visual | `replicacao.avatar_estilo`, contact sheet e direção aprovada | 3D ou real, acabamento e tratamento do cenário. “Expert” não determina fotorealismo. |
| Engine | Perfil/plano e rota suportada | Modelo, modo, referências anexadas, presets e limites técnicos efetivamente conferidos. |

No fluxo atual, o destino comum é Flow com Veo 3, tanto para DTC quanto para Bruno e outros experts. Frames é a preferência habitual; Elements/Ingredients fica para a composição que demande referências adicionais. As imagens podem vir de Nano Banana ou ChatGPT. Isso não distingue os formatos: um podcast conserva olhar/interlocutor e ângulo próprios mesmo usando o mesmo Veo do vídeo de receita. O registro de quatro módulos é inicial; mapear os demais a partir dos vídeos reais.

## Resolver voz e cadência

Antes de fixar direção, aplicar `../etapas/contexto/SKILL.md`. Apresentação infantil/adulta/idosa vem da personagem observada e dos seus materiais; gênero ou idade da pessoa da REF não a substituem. O trabalho não precisa de nova pergunta quando o contexto já resolve essa apresentação. Velocidade, volume e sotaque continuam independentes da idade vocal.

Usar o material e a direção aprovados para aquele personagem. Consolidar a orientação efetiva em `copy.versoes[].direcao_voz` antes de exportar novos trabalhos; versões podem conter uma orientação específica do vídeo. A referência técnica de voz fica no perfil/plano e é conferida pelo controlador. Texto descrevendo interpretação não comprova timbre nem clonagem.

Vínculo técnico de voz é opcional por padrão. `voiceBinding: required` é uma exigência específica de um perfil/trabalho, como o Bruno, nunca uma consequência de usar Frames. Voz livre continua com apresentação coerente com a personagem, sem cadastrar uma voz só para preencher o plano.

Uma entrega calma e uma entrega ágil podem usar o mesmo formato. Tom alto e acelerado do Bruno é uma preferência específica dele, preservada no gerador atual para compatibilidade. Os módulos gerais não contêm seus bordões, nome de voz, roupa ou projeto. O fallback dos outros personagens é natural, sem imposição de aceleração. Se a identidade vocal for essencial e ainda estiver indefinida, localizar as fontes do personagem ou pedir somente o dado faltante; seguir as etapas visuais independentes.

Bordões vêm do léxico do personagem e entram na fala apenas no escopo de revisão autorizado. Não adicionar palavras para ocupar segundos. Escolher duração após ler a fala na interpretação resolvida, com frase e ação completas. Mudar de formato não altera as falas aprovadas por si só.

Em POV/inserto sem fala, a geração permanece sem diálogo e a locução fica na montagem quando prevista. A existência de uma voz no perfil não transforma todo shot em personagem falando.

## Resolver visual e fonte

A referência fornece composição, ação e estados; o contact sheet fornece identidade e estilo do personagem. Um tratamento específico de cenário exige direção própria do trabalho. O módulo deve manter contato das mãos, objetos e causalidade da ação e declarar o que vai para a edição. Evitar prescrições globais de câmera: câmera fixa no formato não recebe movimento genérico herdado de outro.

Para a mesma REF aplicada a vários personagens, reutilizar a análise da fonte e criar seleções de imagem/planos vinculados a cada personagem. Aplicar o contrato de escala existente; nome igual de frame não autoriza compartilhar uma imagem gerada ou uma voz entre personagens.

## Acrescentar um formato

Quando o usuário pedir um formato novo, documentar sua entrada, imagem inicial, ação/câmera, fala em quadro/off e critérios de revisão num módulo próprio. Acrescentar o formato ao contrato `FORMATOS`, ao registro `FORMAT_MODULES` e ao gerador/lint quando houver comportamento novo. Conferir o roteamento e exemplos de pelo menos dois personagens com interpretações diferentes. Novas variantes visuais podem ser apenas estilo/configuração quando não alteram o comportamento do formato.

Essa é uma arquitetura de produção do Hub. As skills históricas da OP 001 são fontes consultáveis; suas contas, idiomas, CTA, organização de projetos e defaults não são migrados automaticamente para este trabalho.
