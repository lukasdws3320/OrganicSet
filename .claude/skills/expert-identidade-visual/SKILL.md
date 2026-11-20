---
name: expert-identidade-visual
description: Criar o kit visual de um expert ou avatar novo, realista ou 3D, a partir de imagem de referência; gerar close-up, face sheet e body sheet, receber o contact sheet montado pelo usuário e gerar selfie, frontal e frontal em cenário com nomes e pastas automáticos.
---

# Expert — identidade visual e materiais base

Entrada da criação visual de expert do zero e da retomada do kit. O usuário manda a imagem e diz “quero criar um avatar”; o agente prepara e executa os prompts. A montagem do contact sheet final pertence ao usuário. Este fluxo também atende avatar de uma pessoa real: `tipo: real|ia` identifica o dono; `realista|3d` identifica o estilo, e são decisões independentes.

## Resolver a entrada e o destino

1. Ler `experts/AGENTS.md` e resolver o dono pela ficha/contexto. Expert novo usa `00_template-expert/`, renomeia a ficha e entra nos índices da operação, conforme o processo de criação. Em perfil com vários personagens, resolver cada personagem separadamente. Reutilizar pasta e kit existentes ao retomar.
2. Inspecionar a imagem enviada. Se não houver imagem acessível, pedir somente essa referência. Resolver nome pelo pedido/ficha; se ainda faltar, perguntar apenas o nome necessário para nomear o kit. Não inventar identidade civil nem inferir gênero, nacionalidade ou etnia pela aparência. Usar termos neutros no close-up quando o contexto não resolver os pronomes.
3. Resolver estilo pelo pedido e pelas referências existentes. Imagem 3D mantém 3D; fotografia mantém realismo, salvo conversão pedida. Para “Pixar/bonequinho” novo sem outra referência de estilo, inspecionar e anexar `app/InstagramReferenceHub/prompts/referencias/pixel-style-padrao.png` como **estilo**, junto à referência de identidade. É animação 3D suave, não pixel art. Bruno/Mini Chefs já estabelecidos usam sua própria identidade e padrão. A referência de estilo governa acabamento, nunca substitui rosto, roupa ou pose do novo expert.
4. Ler [prompts realistas](references/prompts-realistas.md) ou [prompts 3D](references/prompts-3d.md), conforme o estilo. Conferir as imagens de exemplo somente para entender enquadramento, grade e montagem. Os exemplos mostram pessoas diferentes entre etapas: nunca trocar a identidade atual pela pessoa do exemplo.

O pedido para criar o avatar autoriza a sequência inicial de três imagens. Um pedido para documentar/revisar este processo autoriza documentação, sem disparar gerações. A devolução do contact sheet no contexto desta criação retoma automaticamente a segunda etapa, salvo pedido de apenas guardar/revisar.

## Persistência automática

Tudo fica na pasta do expert, em `Contact Sheet/` e `Fotos/`, sem renomear essas pastas que os sistemas já leem. Para perfil com vários personagens, o nome de cada arquivo identifica o personagem.

- Referência recebida intacta: `04_recebidos/identidade-visual/`.
- Close-up, face sheet, body sheet e contact sheet final recebido: `Contact Sheet/`.
- Selfie, frontal e frontal em cenário: `Fotos/`.
- Registro de retomada e prompts realmente executados: `01_contexto/Identidade visual.md`, ligado pelo índice `01_contexto/01_contexto.md`.

Construir automaticamente os nomes com os prefixos `closeup`, `facesheet`, `bodysheet`, `contactsheet`, `reactselfie`, `frontal` e `frontalcenario`, seguidos pelo nome do avatar sem espaços ou separadores. Preservar a grafia do nome; conservar extensão verdadeira. Exemplos concretos: `contactsheetFabiola.png`, `reactselfieFabiola.png`, `frontalFabiola.png`, `frontalcenarioFabiola01.png`. Cenários adicionais seguem `02`, `03`; documentar qual ambiente corresponde a cada número. Não sobrescrever arquivos diferentes: manter a versão anterior e registrar qual é a vigente. Não renomear kits antigos só para adequá-los à convenção nova.

No registro, salvar: nome/dono/estilo; caminho de cada referência e sua função; etapa atual; arquivo de saída, prompt completo, ferramenta/modelo/configuração efetivamente usados e ID de job quando existir; resultado do QA; próximo passo. Distinguir reconstrução plausível de corpo/roupa/ângulo não visível daquilo que a referência de fato mostra. Dimensões e formato vêm do arquivo baixado; `4k, UHD` no prompt não comprova resolução nativa.

## Etapa 1 — gerar as três bases em sequência

Usar um resultado por tipo, nesta ordem. A dependência de identidade exige coleta e conferência antes do próximo envio.

1. **Close-up:** referência enviada governa identidade. Usar o prompt `closeup` do estilo resolvido. Em 3D, anexar também a referência de estilo quando necessária. Conferir rosto, idade aparente, cabelo e estilo antes de seguir.
2. **Face sheet:** usar o close-up conferido como referência principal. Aplicar o prompt `facesheet`: seis retratos, três colunas por duas linhas, ângulos e ordem do texto, mesma pessoa e roupa, sem texto dentro da imagem.
3. **Body sheet:** usar a identidade/estilo do close-up, conservando a imagem original como referência auxiliar das proporções/roupas que ela efetivamente documentar. Se houver referência corporal específica enviada, ela governa corpo/roupa. Aplicar o prompt `bodysheet`: frente, perfil esquerdo, costas, perfil direito; corpo inteiro com pés, mesma escala, linha do chão e roupa. Partes não documentadas são reconstruções, registradas como tal; não transformá-las em medidas reais da pessoa.

Salvar e abrir cada arquivo coletado para QA. Grade errada, membros cortados, identidade trocada ou estilo incorreto impedem considerar a etapa concluída. Seguir a regra de falha da ferramenta; não repetir indefinidamente ou mudar modelo/estilo por conta própria. Retomar pelo job e arquivo existentes antes de submeter de novo.

A primeira etapa termina com **três arquivos legíveis entregues** e estado `aguardando_contactsheet_do_usuario`. O agente entrega os três links e explica a única ação manual: juntar close-up e face sheet com o body sheet num editor, recortando as cabeças do body sheet como no exemplo `references/exemplos/contactsheet-montado.png`, e colocar o nome do avatar. O usuário escolhe Figma, Canva ou outro editor. O agente não monta nem gera a composição final e não antecipa os reacts.

Quando houver passo a passo separado para essa ação manual, entregar HTML autossuficiente pelo `artefato-marca/scripts/documento.py`, conforme a regra da operação. A entrega normal do kit pode ser apenas os arquivos e uma orientação breve.

## Etapa 2 — receber a montagem e gerar os materiais de uso

1. Abrir a imagem final enviada pelo usuário, conferir personagem e legibilidade das áreas de rosto/corpo e guardar o original. Nomeá-la automaticamente com prefixo `contactsheet` e nome exato do avatar. Renomear o arquivo não significa adicionar/alterar texto na arte. Se a composição estiver errada ou corresponder a outro personagem, pedir somente a correção necessária. Não substituir por uma montagem feita pelo agente.
2. Esse arquivo passa a ser a **única referência de imagem** para as três gerações seguintes. Substituir `@CONTACTSHEET` no prompt pelo nome real do asset e anexar o arquivo de fato. Exemplo resolvido: `Use @contactsheetFabiola as the only reference image.` Um nome digitado não substitui o anexo. Se a ferramenta usar IDs de assets, vincular o ID real na configuração; nunca inventar uma menção que a ferramenta não reconhece. No 3D, o estilo já deve estar estabelecido no contact sheet, sem acrescentar outra pessoa como referência.
3. Gerar automaticamente **react selfie com fundo**, **frontal neutra** e **frontal em cenário**, um resultado de cada, com os prompts completos da variante escolhida. As três imagens são independentes depois de receber o contact sheet; enviá-las em lote quando o provedor/controlador permitir. No Flow, enviar os prompts independentes em rajada, sem aguardar o resultado anterior, e coletar os três jobs depois.
4. Salvar os arquivos em `Fotos/`, fazer QA e atualizar o registro com os caminhos reais. O kit só fica `kit_base_disponivel` com todas as seis imagens geradas e o contact sheet recebido, legíveis e conferidos; erro ou job pendente conserva a etapa real. Conferência técnica do agente não equivale à aprovação humana.

### Composição e cenários

- **Selfie:** braço estendido e perspectiva de selfie, avatar central com cenário visível. Preservar esse enquadramento mesmo em 3D.
- **Frontal:** personagem centralizado horizontalmente, bem visível, mãos preservadas, espaço acima da cabeça e enquadramento da fonte. O avatar 3D conserva as proporções originais do boneco.
- **Frontal em cenário:** personagem centralizado, com o enquadramento e a ação do prompt escolhido. A expressão original “centered slightly to the right” é substituída por “centered horizontally” na versão executada, pois o pedido atual de centralização prevalece sobre o exemplo.
- O personagem ocupa o centro com tamanho suficiente para recorte e animação. A posição no canto do vídeo é feita **na edição posterior**; não gerar o boneco pequeno no canto nem com layout de react já composto.
- Os cenários americanos, a bandeira e os ingredientes da nota são exemplos completos, não identidade obrigatória de todo expert. Usar o cenário solicitado ou já definido para o expert; quando não houver direção, o exemplo da fonte é um cenário disponível, não prova de nacionalidade. Para trocar ambiente, o agente escreve o bloco inteiro com detalhes concretos e registra a adaptação, sem mandar campos para o usuário preencher. Cenários extras só quando pedidos.

## Prompts completos e execução

Preservar os textos realistas da fonte. As transformações de execução são explícitas: resolver alternativas de pronome, vincular o contact sheet verdadeiro, centralizar conforme pedido e trocar apenas o cenário quando a direção do expert/pedido o exigir. Para 3D, usar a adaptação completa já escrita em `references/prompts-3d.md`; não misturar comandos de pele fotográfica com materiais do boneco. Toda adaptação fica no registro, separada da fonte preservada.

Antes do envio, ler o prompt final inteiro: nenhuma alternativa `woman/man`, `her/his`, token `@CONTACTSHEET`, nome entre chaves, campo vazio ou instrução “preencha” pode chegar ao gerador. Os prompts já contêm as instruções visuais; o usuário não escreve prompts. Texto, rótulos e marca d’água ficam fora das imagens geradas, conforme a fonte; o nome na composição final é colocado pelo usuário.

Usar o canal de geração escolhido pelo usuário ou já configurado no projeto, sem fazê-lo escolher ferramenta por rotina. Para Flow/Hub, ler a skill compartilhada `reference-hub` e as instruções do projeto/controlador antes de executar; para Higgsfield, ler `higgsfield-visual-director` e seu schema vivo. Para ferramenta nativa de imagens, aplicar sua skill. Registrar prompt e referências na execução real, não declarar submissão, arquivo salvo ou cadastro feito apenas porque o prompt foi preparado. Se o canal não suportar este kit de identidade, informar a limitação concreta e usar a rota de imagens disponível dentro do escopo autorizado, preservando o estado local e sem fabricar comandos/API.

Na produção posterior, procurar primeiro esses materiais. React selfie usa a selfie pronta como imagem inicial; frontal usa a frontal pronta; cenário já existente reutiliza a respectiva imagem. Movimento/animação pertence ao fluxo de vídeo. Criar outro cenário ou figurino é um novo material, não motivo para refazer as folhas de identidade.

## Entrega

Responder com resultado, links dos arquivos e próximo passo concreto. Na primeira etapa, o próximo passo é a montagem pelo usuário; na segunda, entregar o kit pronto para reutilização. Não declarar novo expert, geração ou integração no Hub como concluídos sem verificar o cadastro e os arquivos correspondentes.
