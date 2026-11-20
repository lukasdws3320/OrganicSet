---
name: replicar-formato-troca-produto
description: Alteração pontual de um vídeo de referência (trocar um objeto ou produto, acrescentar um objeto, trocar a roupa de alguém, trocar uma pessoa por outra/novo avatar, mudar parte do cenário), mantendo pessoas, cena, câmera, gestos, cortes e ritmo do original. Formato TROCA DE PRODUTO no Hub. Usado pela skill geral replicar-referencia.
---

# Formato TROCA DE PRODUTO (alteração pontual)

Ler `../../SKILL.md`. Criado no OrganicSet em 09/11/2026 (caixa La Baleine) e ampliado em 10/11/2026 (Lukas) para qualquer alteração pontual. O vídeo final é a referência com UMA mudança; todo o resto fica igual.

## Antes: a pergunta de início (AGENTS.md)

O aluno já respondeu "só uma alteração" e qual o alcance:
- **Alcance A, até o vídeo pronto:** imagens → aprovação → vídeos no Flow → conferência → edição → página do editor (como a caixa La Baleine).
- **Alcance B, só imagens e prompts:** imagens → aprovação → prompts → página do editor com a imagem e o prompt de cada trecho, **sem gastar crédito de vídeo** (`executar` com `--creditos 0`; a página com `--sem-videos`).

## Cadastro (uma vez por alteração)

- Expert do Hub = o trabalho (ex.: "La Baleine"). O "contact sheet" é a **imagem do que entra na cena**: a foto do produto, do objeto, da roupa, da pessoa nova ou do cenário novo. Projeto do Flow com o nome exato desse expert.
- `library/experts/<slug>/producao.json` traz, além do perfil Flow comum, o campo `alteracao` (o antigo `produto` ainda vale como tipo objeto):

| tipo | campos obrigatórios | exemplo |
|---|---|---|
| `objeto` (padrão) | `original`, `novo`; `texto` se tiver rótulo | `{"tipo":"objeto","original":"a caixa laranja Arm & Hammer","novo":"a caixa de bicarbonato La Baleine","texto":"La Baleine"}` |
| `adicionar` | `novo`, `onde` | `{"tipo":"adicionar","novo":"um vaso pequeno de manjericão","onde":"no balcão, à esquerda da pia"}` |
| `roupa` | `quem`, `novo`; `original` opcional | `{"tipo":"roupa","quem":"a mãe loira","original":"a regata branca","novo":"uma blusa de linho azul-marinho"}` |
| `avatar` | `quem`, `novo` | `{"tipo":"avatar","quem":"a filha morena","novo":"a avatar Ana, ruiva, 25 anos"}` |
| `cenario` | `original`, `novo` | `{"tipo":"cenario","original":"os armários de madeira","novo":"armários brancos lisos"}` |

  - `quem` usa a mesma descrição da pessoa que a análise usa (ex.: "a mãe loira").
  - `idiomaFala`: idioma da fala original. `presentation.voiceDirection`: vozes como na referência.
  - `flow.imageModel` = `Nano Banana Pro`. `flow.videoModel` = **`Veo 3.1 - Fast`** (padrão do OrganicSet; ver AGENTS.md).
- Preparar com `preparar --ref REF --expert <slug> --formato "TROCA DE PRODUTO"`.

## Imagens

1. Imagem inicial de cada shot = quadro original do take + imagem do que entra. O quadro governa todo o resto; a imagem de referência governa só a alteração.
2. Gerar pela ponte Gemini (`bun app/InstagramReferenceHub/scripts/gemini-image.ts --id ... --item STILLnn`) quando o Flow recusar imagem.
3. Conferência antes da aprovação humana: a alteração aparece certa (rótulo legível, roupa inteira, rosto novo estável); nenhum vestígio do que saiu; o resto igual ao quadro original. Falha = `reprovar-imagem` com motivo.
4. Quando a fala mudar e a imagem mostrar algo que o prompt de vídeo descreve (ex.: a foto na tela do celular), ajustar a ação do shot para bater com a imagem nova. Na caixa La Baleine, o SHOT07 falhou por isso.

## Vídeos (só no alcance A)

- Veo em Frames, imagem inicial aprovada. A ação, a câmera e a fala literal vêm da análise; quem fala é a pessoa do quadro.
- O prompt fixa que a alteração permanece do começo ao fim do clipe.
- Insertos sem pessoa falando: sem fala gerada.
- Falas de 2–3 s num clipe de 8 s voltaram "Audio generation failed" no Flow: nesses trechos, acrescentar que a pessoa segue em silêncio com som ambiente até o fim do clipe.

## Entrega

1. Alcance A: juntar os clipes na ordem e nos tempos dos cortes originais (cada clipe usa só a duração da janela). Clipes em `trabalhos/<trabalho>/final/clipes-8s` e `clipes-cortados`.
2. Página do editor (os dois alcances):
   `python3 app/InstagramReferenceHub/scripts/pagina-editor.py --id REF--slug --saida <scratchpad>/editor --titulo "Cortes <nome>" --subtitulo "..." --alteracao "..." [--notas trabalhos/<trabalho>/notas-editor.json] [--sem-videos]`
   e publicar `<saida>/pagina-editor.html` como Artifact, com `root` = `<saida>` e `files` = o conteúdo de `<saida>/arquivos.json`. `notas-editor.json` guarda estado, nota e prompt corrigido por trecho.
