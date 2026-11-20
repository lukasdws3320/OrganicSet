---
name: legenda-versoes
description: Escreve as versões de legenda de um post replicado (V1 da referência, V2 em contraponto, V3 opcional), com a CTA de comentário que casa com o vídeo e a DM que entrega o prometido. Use sempre que o Matheus pedir legenda, outra versão, versão mais curta, mais direta, mais desenvolvida, V2, V3, teste de legenda, trocar a CTA, tirar a receita da legenda, ponte para o produto, palavra de comentário, ou ajustar a DM de um post, mesmo sem citar a skill. Vale para Bruno, Mini Chefs, Giovana e qualquer perfil do Reference Hub.
---

# Versões de legenda

O teste é sempre o mesmo: o vídeo não muda, só a legenda. Por isso cada versão precisa ser diferente o bastante para o resultado dizer alguma coisa, e congruente o bastante com o vídeo para não confundir quem assiste.

## As versões

- **V1 = a legenda da referência**, adaptada ao perfil: @ certo, produto certo, palavra de comentário certa. A estrutura e o ritmo da fonte ficam.
- **V2 = o contraponto da V1.** Olhe a V1 e vá para o outro lado:
  - V1 longa ou com receita inteira: V2 curta e direta. Título, uma ou duas frases do que é, a pergunta, a CTA e o "Salva". A pergunta depende do que o comentário entrega no perfil: receita na DM (Mini Chefs, Giovana: "Quer a receita completa com todas as quantidades e o modo de preparo?") ou link do produto (Bruno: ponte do tema para o Cardápio). Só prometa a receita se tiver o texto com quantidades para a DM.
  - V1 já curta ou só com CTA: V2 mais desenvolvida. Conta o porquê, o resultado, um detalhe que dá vontade, e só então a CTA.
- **V3, quando ele pedir ou quando houver um eixo óbvio a testar:** mesma copy da V1 ou V2 com a ordem trocada (gancho primeiro e título depois, ou CTA no topo). Muda uma coisa só, para dar para ler o resultado.

O pedido dele ganha da regra: se ele pediu "mais direta" e a V1 já é curta, faça a mais direta possível e avise que o contraste ficou pequeno. A lógica é contraste com congruência, não uma fórmula.

Cada versão é um post próprio do mesmo vídeo, agendado em outro dia. Post já publicado não muda pela skill: editar no Instagram é com ele.

## O que não pode passar

- **Até 1000 caracteres** (contados como o Instagram conta, UTF-16). A ferramenta onde ele cola corta no 1000.
- **A CTA sai do assunto do vídeo.** Nada de bloco genérico do produto colado no fim. Uma ou duas frases levam do tema ao produto ("Se dois ovos não resolvem a proteína do dia, as outras refeições precisam ajudar."), depois o convite.
- **Palavra de comentário = a palavra falada no vídeo.** A fala está em `library/replicacoes/<REF>/transcricao.json` ou na análise do Hub; sem transcrição, transcreva (skill `transcricao-assemblyai`) ou mantenha a da V1 e diga que não conferiu. Se o vídeo não pede, use uma palavra do tema. Se o vídeo promete outra oferta (consultoria, outro produto), aponte. Não esconda o conflito.
- **Prometa só o que existe.** "Te envio no direct" exige o texto pronto para a DM. "Essa receita está no Cardápio" exige conferir que está. Produto: só fatos verificados (quantidade, bônus, o que tem dentro). Sem promessa de saúde, caloria ou emagrecimento.
- **@ do perfil** vem do `perfil:` no topo do `Postagens.md`, nunca de memória ou de legenda antiga. Bruno posta como @otimedasestrelas.
- **Imperfeição do Matheus fica** ("tambem", número estranho, ritmo torto): aponte, não corrija. Bordão de vídeo de IA do Bruno ("Tá, Amor?", "Chupa-Cabra") não entra em texto novo.

## Onde gravar

1. `Postagens.md` do perfil, na seção do post, em bloco ```` ```legenda ````. O Hub lê de lá (`legenda_fonte: nota`). Seção de V2/V3 sem bloco próprio pode usar `legenda_de:`: confira o que o Hub mostra.
2. Se o post ainda não está agendado, as versões também ficam em `library/replicacoes/<REF>/<personagem>/legendas-post.json` (`versoes`: `V1`, `V2`…, com `id`, `nome`, `texto`).
3. Agenda e calendário são consumidores: refaça pela skill `calendario-postagens`. Cliente real (Bruno): suba a entrega no roadmap no mesmo turno.
4. Receita que saiu da legenda e foi prometida na DM: texto da DM 02 em `06_roadmap/Receitas para o direct.md` do perfil, no formato de `02_experts-ia/DMs padrão - nicho infantil.md`.

## DM

A sequência é palavra comentada → DM 01 (padrão do perfil) → DM 02 (o que o post prometeu + link). O texto das DMs padrão é do Matheus: use com as palavras dele. Toda palavra nova de CTA precisa estar cadastrada na automação: liste as palavras novas no fim da entrega e diga que não conferiu a automação, a menos que tenha conferido. Montar a automação na ferramenta é com a skill `dm-automation`.

## Antes de entregar

Rode o verificador em cada legenda nova:

```bash
python3 scripts/checar_legenda.py --perfil "@otimedasestrelas" --palavra "EU QUERO" arquivo.txt
```

Ele mede os 1000 caracteres, acha @ errado, palavra ausente, travessão, promessa de saúde e bloco genérico repetido. Depois confira no Hub (`GET /api/posts?profile=<slug>`) que o texto que aparece é o novo.

Entrega curta: quantas versões, onde ficaram, a contagem da maior, as palavras de comentário novas e o que só ele faz (automação, post já publicado que precisa de edição no Instagram).
