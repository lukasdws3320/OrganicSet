---
name: alteracao-pontual
description: Preparar a alteração pontual de um vídeo de referência (trocar objeto/produto, acrescentar objeto, trocar roupa, trocar a pessoa por avatar nova, mudar parte do cenário) mantendo pessoas, cena, câmera, gestos, cortes e fala; gerar as imagens iniciais no Nano Banana Pro com lote piloto e escrever os prompts de vídeo para Veo 3, Kling, Seedance 2.0 e MiniMax. Usar em qualquer pedido de vídeo nesta pasta.
---

# Alteração pontual

Método criado no OrganicSet (Lukas Valen, nov/2026) com o anúncio da caixa de bicarbonato: Arm & Hammer → La Baleine, 22 trechos.

## 1. Preparar

`py scripts\preparar.py --nome <nome> --video "<arquivo ou link>" --referencia "<imagem do que entra>"`

Sai `projetos\<nome>\projeto.json`, com um trecho por corte de câmera (máx. 8 s; trecho maior é partido na pausa da fala), a fala transcrita e os quadros. Conferir o resultado:
- trecho com fala cortada no meio de palavra: ajustar `ini`/`fim` no projeto.json;
- transcrição errada (nome de marca, número): corrigir `fala` ouvindo o original.

Preencher no `projeto.json`:
- `alteracao`: `{"tipo": "objeto|adicionar|roupa|avatar|cenario", "descricao": "..."}`;
- em cada trecho, olhando `Txx_tira.jpg` (início, meio e fim):
  - `quem`: quem aparece e quem fala, sempre com a mesma descrição (ex.: "a mãe loira");
  - `acao`: o que acontece, em ordem;
  - `camera`: plano, altura, ângulo e movimento.

Use `Read` nas imagens para ver; não adivinhe.

## 2. Prompt de imagem (`prompt_imagem` de cada trecho)

Referência 1 = quadro original (governa tudo). Referência 2 = imagem do que entra (governa só a alteração). Modelos:

- **objeto:** "Edite a Referência 1 trocando um único objeto: {original} vira {novo}, idêntico ao produto da Referência 2. O produto novo ocupa exatamente o lugar do antigo: mesma posição, tamanho, ângulo, perspectiva, foco e sombra; mãos, copos, braços e bordas do quadro que cobrem o antigo continuam cobrindo o novo. Copie a frente da embalagem com fidelidade: texto "{texto}" nítido e legível, mesmas cores e proporção; nas laterais, continue cores e desenho sem inventar textos. Nenhum vestígio de {original}. Todo o resto fica igual à Referência 1: pessoas, rostos, cabelos, roupas, poses, mãos, cenário, objetos, luz, cor, profundidade de campo, enquadramento. Não acrescente, remova nem mova mais nada."
- **adicionar:** "Edite a Referência 1 acrescentando um único objeto: {novo}, idêntico ao da Referência 2, {onde}. Escala, perspectiva, luz, sombra e foco coerentes; o que está na frente desse lugar continua na frente. Todo o resto igual..."
- **roupa:** "Edite a Referência 1 trocando só a roupa desta pessoa: {quem}. Sai: {roupa antiga}. Entra: {roupa nova}, como na Referência 2. Mesmo rosto, cabelo, corpo, pose e mãos; caimento, dobras, luz e sombra coerentes com a pose; nenhum pedaço da roupa antiga. Todo o resto igual..."
- **avatar:** "Edite a Referência 1 trocando só {quem} pela pessoa da Referência 2: rosto, cabelo, tom de pele e traços dela; mesma pose, gesto, expressão, direção do olhar, posição, escala e roupa que {quem} tem na Referência 1. Todo o resto igual..."
- **cenario:** "Edite a Referência 1 mudando só o cenário. Sai: {parte antiga}. Entra: {novo}, como na Referência 2. A luz do cenário novo combina com a luz nas pessoas; perspectiva e profundidade de campo iguais. Pessoas, roupas, poses, mãos, objetos em primeiro plano e enquadramento iguais."

Ajuste por trecho só o necessário (ex.: "a caixa aparece cortada pela borda direita, como na Referência 1"). Se um trecho mostra algo que depende da alteração (tela de celular, foto, reflexo), descreva o que deve aparecer.

## 3. Piloto (antes de gerar o resto)

1. Escolher 3 trechos e gravar em `projeto.json` → `"piloto": ["Txx","Tyy","Tzz"]`:
   - um aberto, que mostra a cena inteira;
   - um close, onde a alteração aparece grande e o rótulo tem que estar legível;
   - o mais difícil: mão na frente, ângulo torto, alteração pequena no canto, pessoa de perfil.
2. `py scripts\imagem.py --projeto <nome> --trecho Txx` para cada um.
3. Conferir você mesmo em `conferencia\Txx.jpg`, com o original à esquerda:
   - alteração certa e nítida (rótulo legível, roupa inteira, rosto estável);
   - nenhum vestígio do que saiu;
   - o resto idêntico.
   Falhou: refazer com `--correcao "<o que corrigir>"` antes de mostrar.
4. Colocar `estado: "piloto"` nesses trechos, rodar `py scripts\pagina.py --projeto <nome> --piloto` e abrir a página. Pedir ao editor: "aprovado" ou o que mudar.
5. Reprovado: ajustar os `prompt_imagem` (o motivo vale para todos os trechos parecidos), refazer o piloto e mostrar de novo.

## 4. Resto das imagens

Depois do OK, gerar os outros trechos um a um e conferir cada imagem do mesmo jeito.
- Imagem boa: `estado: "aprovado"`.
- Defeito pequeno: `estado: "ressalva"` com `nota`.
- Defeito grave, depois de 2 refações: `estado: "refazer"` com `nota`.

Não mostrar imagem por imagem ao editor; ele vê tudo na página final.

## 5. Prompts de vídeo

Em cada trecho, `prompts` = `{"veo3": {...}, "kling": {...}, "seedance": {...}, "minimax": {...}}`. Cada IA é um objeto `{"prompt": "...", "config": "..."}`. O `config` é uma linha para o editor ajustar a ferramenta, ex.: "Imagem para vídeo · 5 s · usar 4,30 s · áudio ligado".

Base comum, escrita para cada IA no estilo dela:
- **Fixar a cena:** as mesmas pessoas, roupas, cenário e luz da imagem inicial. Cada pessoa mantém do começo ao fim o mesmo rosto, idade, cabelo e roupa. A alteração permanece igual no clipe inteiro (mesma forma, rótulo legível, sem virar outra coisa).
- **Ação e câmera do original,** em ordem, com plano e movimento.
- **Fala:** literal, entre aspas, no idioma original, com quem fala. Diálogo: "X diz: '...'. Em seguida, Y diz: '...'". Sem fala: "sem falas, só som ambiente".
- **Sem música;** voz limpa e seca.

Por IA (as ferramentas mudam rápido: se o editor disser que algo mudou, seguir o que ele disser):
- **Veo 3** (Google Flow, modo Frames, imagem inicial):
  - clipe de 8 s; `config`: "Frames · 8 s · usar X s".
  - Prompt em português funcionou bem; a fala vai no idioma original.
  - Fala de 2 a 3 s num clipe de 8 s às vezes volta "Audio generation failed". Nesses trechos, acrescentar: "depois da fala, a pessoa continua em cena em silêncio, com o som ambiente, até o fim do clipe".
- **Kling** (Imagem para vídeo):
  - duração 5 s se o trecho couber, senão 10 s.
  - Prompt em inglês, direto: sujeito, ação, câmera.
  - `config` com sugestão de negative prompt: "face change, morphing, distorted text, changing logo, extra fingers".
  - Fala: se a versão gerar áudio, a fala vai entre aspas; se não, gerar mudo com "talking naturally" e sincronizar a boca com o Lip Sync. Dizer isso no `config`.
- **Seedance 2.0:**
  - imagem inicial como primeiro quadro (@image1).
  - Duração: o trecho arredondado para cima, em segundos.
  - Prompt em inglês. Pedir "one continuous shot, no cuts", a não ser que o trecho original tenha corte.
  - Fala entre aspas, com quem fala; ele gera o áudio.
- **MiniMax (Hailuo)** (Imagem para vídeo):
  - duração 6 s se couber, senão 10 s.
  - Prompt em inglês, com os comandos de câmera entre colchetes: [Static shot], [Push in], [Pull out], [Pan left], [Tracking shot].
  - Não gera fala sincronizada: pedir "speaking naturally, mouth moving" e avisar no `config`: "fala entra na edição (dublagem/lip sync)".

## 6. Entrega

1. `py scripts\pagina.py --projeto <nome>`, depois abrir `projetos\<nome>\entrega\pagina.html`.
2. Dizer ao editor:
   - quantos trechos estão prontos, com ressalva e para refazer;
   - que cada clipe deve usar só o tempo de "usar";
   - que a montagem segue a ordem T01 → Tnn.

## 6b. Fluxo áudio primeiro (MiniMax + Dreamface, padrão da operação)

Quando o editor for usar lip sync, siga estes passos:
1. **Escreva o roteiro com quem fala e a emoção de cada fala**, olhando a expressão no vídeo original.
   - Salve em `projetos\<nome>\falas.json`, no formato `[{"id":"F01","corte":"T01","quem":"filha","texto":"..."}]`.
   - Entregue a copy em linhas "Filha: ..." / "Mãe: ..." para colar inteira no MiniMax, junto com uma tabela de emoções.
2. **Corte o áudio.** O editor gera um arquivo só no MiniMax e manda. Rode `py scripts\audio.py --falas projetos\<nome>\falas.json --audio "<arquivo>" --saida projetos\<nome>\audios`.
   - O script acha cada fala, tira o rótulo falado e grava F01.wav, F02.wav... e um `cortes.json` com os cortes de até 8 s.
   - Se aparecer "não encontrei esta fala", ouça o áudio: provavelmente o MiniMax mudou palavras.
3. **Escreva o prompt de cada corte de vídeo para lip sync.** O vídeo sai sem fala gerada e sem música, sem cortes dentro do clipe. Durante o clipe:
   - o rosto de quem fala fica nítido e de frente, sem desfoque nem giro de cabeça, e nada fica na frente da boca;
   - quem fala começa de **boca fechada e neutra** por meio segundo e depois abre a boca naturalmente;
   - quem não fala fica de boca fechada e só reage.
4. **Ajuste ações do original que atrapalham o lip sync:** mão ou copo na frente da boca, fala de perfil, borrão de movimento, câmera que sai do rosto durante a fala. Explique cada ajuste numa nota do corte.
5. **Cortes com duas falas** precisam de dois lip syncs no Dreamface, um para cada pessoa.

Exemplo completo: a página "Cortes La Baleine v2" (https://claude.ai/artifact/P4aHfwPGbm3rG9uDoniszG).

## 7. Conferir clipes gerados (quando o editor pedir)

Para cada clipe da pasta que o editor indicar (nome = trecho, ex.: T04.mp4):
1. Quadros: `ffmpeg -v error -y -i T04.mp4 -vf "fps=1,scale=200:-2,tile=8x1" -frames:v 1 projetos\<nome>\conferencia\T04_clipe.jpg`. Olhe com `Read`: mesmo rosto do começo ao fim, alteração estável e legível, nada do que saiu, cena igual.
2. Fala: extrair o áudio e transcrever com o faster-whisper (mesmo modelo do preparar.py) e comparar com a `fala` do trecho.
3. Responder em lista: pronto ou refazer, com o motivo e o que mudar no prompt.

## Lições do projeto La Baleine

- **Imagem e prompt de vídeo têm que contar a mesma história.** A imagem mostrava uma assadeira na tela do celular, mas o prompt ainda descrevia "a foto de uma mulher" do original. O clipe saiu errado.
- **Alteração no canto da imagem,** cortada pela borda, deforma no vídeo. Na imagem, deixe o objeto um pouco mais inteiro, se o original permitir.
- **Rosto que muda na segunda metade do clipe** é o defeito mais comum. O prompt precisa repetir "mesmo rosto do começo ao fim".
- **Veo 3.1 Fast** saiu no mesmo nível do Quality, que custa 5 vezes mais.
