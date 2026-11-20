# Matheus Marcolino — Brand Atlas

Sistema de identidade visual · Edição 01 · Revisão 1.4 · 24 de outubro de 2026

## Direção

“Entre a forma e a ideia” nomeia a direção visual desta edição. É um conceito editorial para o sistema, não uma promessa comercial. A base combina preto absoluto, branco puro, tipografia expressiva e campos de luz granulada. O nome completo é a assinatura; “Brand Atlas” nomeia a apresentação do kit.

Três princípios: contraste para organizar, expressão para dar intenção e matéria para trazer textura. Esta identidade foi criada a partir das duas referências fornecidas. Não reutiliza a identidade anterior.

## Assinatura e monograma

A assinatura principal usa “matheus” em DM Sans Light e “marcolino” em DM Serif Display Italic, em duas linhas centralizadas. O ponto terminal é opcional nas aplicações tipográficas; os arquivos mestres incluem o ponto na mesma cor da assinatura. O monograma é um par de letras m em DM Serif Display Italic com deslocamento vertical.

- Arquivos SVG entregues em curvas: independem da instalação das fontes.
- Versões preta e branca, com fundo transparente.
- Área de proteção: no mínimo a altura do m minúsculo da assinatura em todas as direções.
- Tamanho mínimo da assinatura: 160 px em tela; 40 mm em impressão.
- Tamanho mínimo do monograma: 32 px em tela; 8 mm em impressão.
- Abaixo desses tamanhos, use apenas o favicon simplificado do site; não comprima a assinatura.
- Não esticar, inclinar, contornar, acrescentar sombras, mudar a ordem das linhas ou colorir cada letra.
- Assinatura branca sobre base preta e preta sobre base branca ou acentos claros. Não aplicar sobre o trecho mais luminoso da textura.

## Paleta

| Nome | HEX | RGB | Uso |
|---|---|---|---|
| Absoluto | #000000 | 0, 0, 0 | Fundo escuro, texto no tema claro, assinatura |
| Branco | #FFFFFF | 255, 255, 255 | Fundo claro, texto no tema escuro, assinatura |
| Brasa | #EE794E | 238, 121, 78 | Acento principal e campos de luz |
| Névoa | #C8DDD2 | 200, 221, 210 | Luz secundária |
| Ar | #AFC2ED | 175, 194, 237 | Luz secundária |
| Eco | #C1AFE0 | 193, 175, 224 | Luz secundária |

Neutros funcionais: superfície escura #0B0B0B; superfície clara #F4F4F4; texto secundário escuro #A3A3A3; texto secundário claro #595959; bordas escuras #2C2C2C e claras #D4D4D4.

Proporção de referência: 80% neutros, 15% atmosfera e 5% acento. É uma orientação de composição, não uma medição obrigatória por pixel. Use apenas um acento sólido dominante por peça. O campo de luz pode misturar os quatro acentos.

### Contraste

Para texto, use branco no preto (21:1), preto no branco (21:1) ou preto sobre os quatro acentos. Não usar texto branco sobre os acentos claros. Texto secundário: #A3A3A3 no preto e #595959 no branco. Os valores calculados estão em `tokens.json`.

Os códigos são sRGB para uso digital. Para impressão, converter com o perfil ICC da gráfica e aprovar prova física. Não há equivalente Pantone nem CMYK universal definido neste kit.

## Tipografia

### DM Sans

Pesos 300, 400, 500 e 600. Corpo, interface, navegação, apoio aos títulos e a primeira linha da assinatura. É a voz clara do sistema. Usar 400 em textos corridos e 500 em controles; 300 em títulos leves.

### DM Serif Display

Regular e Italic, peso 400. Títulos expressivos e palavras-chave. O itálico deve marcar uma intenção, preferencialmente uma expressão por composição. Evitar blocos de texto inteiros em itálico.

### DM Mono

Pesos 400 e 500. Índices, códigos, legendas e notas técnicas. Não usar como fonte de leitura longa.

| Papel | Desktop | Mobile | Entrelinha | Tracking |
|---|---|---|---|---|
| Display | até 112 px | referência 52 px, fluido 46–68 px | 1.02 | −0.04 em |
| Título | até 64 px | 40 px | 1.08 | −0.035 em |
| Apoio | 24 px | 20–24 px | 1.2 | −0.02 em |
| Texto | 18 px | 16 px | 1.6 | 0 |
| Nota | 12 px | 12 px | 1.5 | +0.06 em |

Notas decorativas podem reduzir a 10 px; informações necessárias para leitura continuam a partir de 12 px. O site contém texto editável para experimentar família e tamanho. Não usar a escala de display em parágrafos.

As oito fontes e as três licenças SIL Open Font License estão incluídas. As famílias escolhidas interpretam o contraste das referências; não representam uma identificação forense das fontes nas imagens.

## Composição

- Eixo principal centralizado; texto corrido pode alinhar à esquerda dentro da coluna central.
- Largura máxima de conteúdo: 1120 px.
- Grid de referência: 12 colunas com gutter de 24 px no desktop; 4 colunas com gutter de 16 px no mobile.
- Margem externa: 48 px no desktop, 32 px em telas intermediárias, 24 px no mobile e 16 px abaixo de 360 px.
- Base de espaçamento: 8 px. Escala: 8, 16, 24, 32, 48, 64, 96 e 128 px.
- Seções: 128 px de respiro vertical no desktop, 80 px no mobile.
- Corpo de leitura: preferencialmente 45–70 caracteres por linha.
- Bordas: 1 px. Cantos editoriais de 0–4 px; botões e seletores arredondados em 999 px.
- Elementos de margem: índices, edição e notas. Manter o centro como principal área de leitura.
- Evitar sombras pesadas, molduras concorrentes e excesso de cartões.

## Textura e imagem

Órbita (`orbita.jpg`) e Refração (`refracao.jpg`) são as duas expressões ativas: uma elipse ampla e dois arcos assimétricos, com luz difusa e granulação integrada. Os mestres originais permanecem preservados.

Pode ser recortado, ampliado proporcionalmente e posicionado de forma a preservar uma área calma para texto. Não repetir em mosaico nem aplicar filtros que eliminem a granulação. Na versão clara do site, a mesma arte é exibida como negativo cromático com ajuste de matiz; a paleta sólida continua inalterada.

O grão é integrado às artes e aos fundos pretos e brancos, atrás dos elementos de conteúdo. Nos fundos, usar 2.4% de opacidade. Não aplicar filtros de ruído à tela inteira, aos botões ou aos arquivos vetoriais da assinatura.

## Movimento

- Revelação: opacidade de 0 a 1 e translação vertical de 40 px a 0 (28 px no mobile), em 900 ms.
- Curva: cubic-bezier(0.2, 0.65, 0.25, 1).
- Rolagem: Lenis 1.3.26 hospedado localmente, interpolação de 0.085 no mouse, inércia sincronizada no toque e navegação suave nos links. Sem travar o usuário em seções; iOS anterior ao 16 preserva o toque nativo por compatibilidade.
- Abertura: cena aderente, com arte inteira ajustada ao espaço disponível (contain). O título recua até 64 px, reduz até 0.91× e sua opacidade acompanha a saída da cena. A arte não gira, não amplia e não flutua ao rolar.
- Texturas: movimento interno com deslocamento SVG nativo. A posição e a escala do quadro permanecem fixas.
- Tipografia de demonstração: deslocamento horizontal leve de até 36 px.
- Revelações reaparecem ao revisitar os blocos. No mobile, deslocamentos de entrada menores.
- Estados de botões: 180–200 ms; escala ao pressionar de 0.96.
- Movimento reduzido: desativar revelações, parallax e rolagem suave. Todo conteúdo permanece acessível.

## Aplicações

1. Capa editorial A4: assinatura discreta, título central em três tempos, arte como atmosfera. Sangria sugerida de 3 mm e área segura de 12 mm para produção impressa, sujeitas à especificação da gráfica.
2. Posts de feed: 1080 × 1350 px, margem segura mínima de 80 px; títulos grandes e uma expressão em serifada itálica. Versões branca e preta.
3. Página editorial: navegação leve, título centralizado e notas periféricas. É um estudo de aplicação, sem proposta de serviço, biografia ou pitch.
4. Avatar: monograma centralizado, ocupar no máximo 60% da área, prever corte circular.

Os exemplos são estudos demonstrativos, não anúncios ou materiais previamente publicados pelo titular da marca.

## Referências selecionadas

- Imagem de portfólio fornecida: campos orgânicos de luz e granulação.
- Imagem tipográfica fornecida: contraste entre sans leve, serifada itálica expressiva e serifada regular.
- [Raycast no Refero](https://styles.refero.design/style/3b6a17f0-3bdf-418c-a95e-0b89e5a8b2f8): base escura, cor pontual e bordas discretas.
- [Figma no Refero](https://styles.refero.design/style/5fd3b3b4-02ab-456a-87aa-e4395636b671): respiro e hierarquia por escala.
- [AI for Business no Refero](https://styles.refero.design/style/ee403055-480e-4bd4-9216-07c9ae2dde2e): presença editorial e contraste de tamanhos.

Nenhuma imagem de terceiros do Refero foi incorporada como ativo da marca. Referências externas orientaram decisões de composição.

## Conteúdo do pacote

`manual.md`, `tokens.json`, `brand-tokens.css`, SVGs de assinatura e monograma, `orbita.jpg`, `refracao.jpg`, oito fontes TTF e três licenças. A entrega local completa acrescenta o código do site e o PNG mestre da arte.

Para uso das fontes em ferramentas de design, instale os TTFs. Para logotipos, prefira os SVGs em curvas. O site estático funciona sem dependências de build e sem requisições a serviços de fontes.

## Duas expressões, desenhos de referência preservados

- `index.html`: abertura padrão em Órbita, em preto e branco.
- `orbita.html`: Órbita inicial, com a elipse ampla e a mesma distribuição de pigmentos da referência.
- `refracao.html`: Refração inicial, com o arco superior amplo e a segunda mancha deslocada na base.

Na revisão 1.3, Órbita e Refração voltam aos arquivos originais `orbita.jpg` e `refracao.jpg`. Não houve nova geração, mudança de forma ou reposicionamento das manchas. A página usa cópias WebP comprimidas desses arquivos; as versões escuras aplicam o tratamento exato da primeira apresentação: `invert(1) hue-rotate(180deg) saturate(.8)` apenas na arte. Tipografia, botões e o restante da interface não recebem esse filtro.

O download do laboratório entrega o JPG original. Nas versões escuras da Órbita e Refração, o tratamento cromático pertence à apresentação da página, e está documentado acima. Os SVGs de assinatura, as fontes, os tokens e os originais ficam no kit.

A arte usa enquadramento 3:2 com contain e uma transição leve nas bordas. A composição original ocupa o quadro novamente; as variações regeneradas com margens grandes ficam apenas no arquivo histórico. Nenhum novo preenchimento por IA foi usado nesta restauração.

## Carregamento e execução

- Imagens WebP com fontes responsivas de 768 e 1536 px. O navegador escolhe a resolução pela largura e densidade da tela.
- Abertura com prioridade alta; quatro imagens abaixo com lazy loading e decodificação assíncrona.
- Fontes WOFF2 para a página. TTFs originais preservados no pacote para uso em outras ferramentas. Conjunto de caracteres: Latin, Latin Extended, acentos, marcas combinantes, pontuação, moedas e símbolos da interface.
- Apenas o efeito da abertura é construído imediatamente. Os demais são preparados a até 240 px da tela. Superfícies fora do viewport não alteram atributos do efeito.
- O SVG reutiliza `currentSrc` da imagem, inclusive a resolução escolhida pelo navegador.
- CSS de tokens carregado diretamente, sem uma cadeia de importação. Fontes principais antecipadas; scripts com defer.
- Leituras de geometria agrupadas antes das alterações de estilo no scroll.

As imagens responsivas WebP e as fontes WOFF2 reduzem o peso dos arquivos. Os TTFs e JPGs originais continuam disponíveis. Tamanho de arquivo não equivale a uma medição de desempenho no navegador.

## Movimento interno dos degradês

O motor SVG nativo da revisão 1.2, confirmado pelo usuário, permanece na revisão 1.3 sem alterar o campo de movimento nem seu ritmo. Um campo de deslocamento (`feTurbulence` + `feDisplacementMap`) modifica o pigmento dentro da imagem. O quadro não sobe, não desce, não gira e não muda de escala. O deslocamento máximo é de 24 unidades por eixo na arte de 1536 × 1024; a amplitude e a frequência variam continuamente com curvas senoidais suaves.

Uma linha de tempo única controla as superfícies visíveis, com atualização de atributos até aproximadamente 30 vezes por segundo. Pausar congela o tempo. Retomar continua do mesmo instante. A troca de arte respeita o tempo atual. Abas ocultas suspendem o ciclo; superfícies fora da tela não atualizam o filtro.

Há controles no cabeçalho e junto do laboratório. Os estados diferenciam carregamento, movimento ativo, pausa e falha da arte. Sem carregar a camada animada, a imagem estática permanece visível. A preferência do dispositivo por movimento reduzido é respeitada inicialmente; o visitante pode ativar explicitamente apenas o fluxo dos degradês. A rolagem e as entradas continuam respeitando o movimento reduzido do sistema.

O granulado pertence ao fundo de cada superfície: opacidade de 2.4%, estático e quase imperceptível. Não há camada fixa sobre a tela. Textos, botões e amostras de cor mantêm sua própria pintura limpa.

Referências técnicas: [Lenis](https://github.com/darkroomengineering/lenis), licença MIT incluída; [feDisplacementMap](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/feDisplacementMap). Referências visuais adicionais: Framer e Jitter no Refero. Os efeitos foram desenvolvidos para este site, sem copiar animações dessas referências.

## Revisão 1.4 — 24/10/2026

Expressões ativas: somente Órbita e Refração. Órbita é a entrada padrão do site; o Reference Hub usa Refração no início e nos estados vazios. O Halo foi retirado da navegação, do laboratório e do pacote ativo. Arquivos anteriores permanecem apenas como histórico local. O backup da apresentação anterior está em `site/history/2026-10-24-antes-retirada-halo.zip`. A Refração usa o original claro e o tratamento cromático documentado acima no tema escuro, preservando a composição completa.

