# Produção de anúncios com alteração pontual (decisões e lições, 09–10/11/2026)

Decisões do Lukas Valen e o que aprendemos no anúncio da caixa de bicarbonato (Arm & Hammer → La Baleine, REF-2026-11-0001). Vale para qualquer agente aberto nesta pasta: Claude Code no VS Code ou no app desktop, Codex ou outro.

## Decisões do Lukas

- **Objetivo:** produzir anúncios o mais rápido possível. A operação tem 2 editores sênior. O OrganicSet é uma ferramenta a mais na mão deles.
- **Divisão de trabalho recomendada e aceita:** o agente faz até as imagens e os prompts. O editor gera os vídeos na IA que preferir (Veo 3, Kling, Seedance 2.0, MiniMax) e monta.
- **Pergunta de início** em todo projeto novo (detalhe no AGENTS.md): processo completo ou só uma alteração; e, na alteração, até o vídeo pronto ou só imagens e prompts.
- **Modelo de vídeo padrão: Veo 3.1 - Fast.** Lukas pediu o mais barato e depois preferiu o equilíbrio custo × resultado. Lite só a pedido.
- **Piloto de 3 imagens** antes de gerar o resto, aprovado pelo editor. Os 3 trechos são: um aberto, um close da alteração e o mais difícil. Depois do OK, o agente confere sozinho e só marca as que tiverem dúvida.
- **Editores rodam na máquina deles** (Windows, conta própria do Claude), com a versão enxuta `distribuicao/OrganicSet Edicao`. A chave do Gemini é sempre enviada pelo Lukas; nunca fica em arquivo da pasta nem no chat.

- **Página de referência atual: "Cortes La Baleine V3"** (https://claude.ai/artifact/PSCMYjWgQXMMh7QqqFqi1E).
  - Mostra só o fluxo novo, sem os vídeos antigos. A V2 virou histórico.
  - Gerada por `trabalhos/troca-caixa-bicarbonato/gerar_v3.py`.
  - O guia dos editores já ensina VS Code + extensão Claude Code e "Copiar como caminho" para mandar o áudio.
- **Fluxo áudio primeiro** (proposto pelo editor em 11/11/2026; aplicado primeiro na V2: https://claude.ai/artifact/P4aHfwPGbm3rG9uDoniszG):
  1. roteiro com falante e emoção por fala;
  2. um áudio por fala no **MiniMax**, com emoção;
  3. o Claude mede os áudios e monta cortes de até 8 s;
  4. vídeo **mudo** por corte, com a boca de quem fala sempre livre, o rosto de frente e quem não fala de boca fechada;
  5. lip sync no **Dreamface**, um por fala.

  Ferramentas da operação: MiniMax, Dreamface e **HeyGen** (tradução de vídeo com lip-sync; o Lukas fala "regen", não é o Rask). Em 20/11/2026, no BIC_148 ESP, o Dreamface recusou as avatares de IA como "famosas", e o HeyGen reescreveu a copy para caber no tempo e trocou falantes; ver `trabalhos/bic-148-esp/`. Script: `trabalhos/troca-caixa-bicarbonato/fluxo_lipsync.py`. O editor confirmou (11/11):
  - **A copy vai inteira num arquivo só no MiniMax**, com "Filha:"/"Mãe:". O corte por fala é automático: `scripts/audio.py` da versão enxuta acha cada fala, tira o rótulo falado e gera um arquivo por fala, mais os cortes de até 8 s. Testado com áudio simulado: 25 de 25 falas cortadas certas.
  - **No Dreamface, a boca começa fechada:** quem fala começa com a boca fechada e depois abre.

## Versão enxuta para os editores

- Pasta: `distribuicao/OrganicSet Edicao/`. Pacote para enviar: `distribuicao/OrganicSet-Edicao.zip`. Sem Hub, sem Flow, sem navegador.
- Conteúdo:
  - scripts `preparar.py` (cortes + transcrição faster-whisper + quadros), `imagem.py` (Nano Banana Pro pela API Gemini) e `pagina.py` (página HTML única, com abas por IA);
  - skill `alteracao-pontual`;
  - atalhos `Instalar.bat`, `Configurar chave.bat` e `Abrir OrganicSet.bat`.
- Guia dos editores (abas: Instalação → Chave → Passos 1–6 → Dúvidas): https://claude.ai/artifact/TtuHgR8E7ssgRNSnasCXD2. Para o time abrir, compartilhar pelo menu Share.
- **O guia tem um botão para baixar o .zip** (capability downloads; o .zip vai embutido na página). Os arquivos-fonte ficam em `distribuicao/guia/`.
  - **Cada vez que o .zip mudar:**
    1. rodar `distribuicao/guia/gerar-guia.ps1`;
    2. publicar `distribuicao/guia/guia-com-download.html` no mesmo artifact do guia (`url`, root `distribuicao/guia`, files `img/*`).
  - Se não fizer isso, o botão continua entregando a versão antiga.
- Mudou um script ou a skill: refazer o .zip (`Compress-Archive -Path "OrganicSet Edicao" -DestinationPath OrganicSet-Edicao.zip` dentro de `distribuicao/`) e reenviar aos editores. Se o passo a passo mudar, atualizar o guia.
- Testado em 10/11 com o vídeo da La Baleine:
  - preparar: 22 trechos, iguais aos do Hub;
  - imagem: caixa trocada certa;
  - página: piloto gerado.
  Ainda não testado num Windows limpo de editor.
- O faster-whisper recebe o áudio pelo ffmpeg (numpy), porque o PyAV novo quebrou o `transcribe(arquivo)`.

## Lições do anúncio La Baleine

- **Imagem e prompt de vídeo contam a mesma história.** Na imagem do SHOT07, o celular mostrava uma assadeira; o prompt ainda dizia "foto de uma mulher". O clipe saiu errado.
- **Fala curta** (2–3 s num clipe de 8 s) voltou "Audio generation failed" no Flow, duas vezes no mesmo trecho. Falas longas passaram.
- **Rosto que muda na segunda metade do clipe** é o defeito mais comum. O prompt repete "mesmo rosto do começo ao fim".
- **Alteração no canto,** cortada pela borda, deforma o rótulo no vídeo.
- **Veo 3.1 Fast** (20 créditos) saiu no nível do Quality (100).
  - O Flow desta conta é PRO, com créditos mensais (renovam dia 4).
  - Falha não é cobrada.
  - Lite = 10 créditos.
- **A chave do Gemini é pré-paga** (Google AI Studio). Em 11/11/2026 os créditos acabaram no meio de um trabalho (erro 402, "prepayment credits are depleted"). Os editores usam a mesma chave, então o Lukas precisa acompanhar o saldo e recarregar. O `imagem.py` da versão enxuta explica esse erro em português.
- **Centralizar uma pessoa no quadro:** o Nano Banana mantém a posição da foto de referência, mesmo pedindo "centro" ou "câmera deslocada". O que funciona: deslocar a imagem com ffmpeg (`crop` + `pad`) até o rosto ficar no meio e pedir ao Gemini para preencher só a faixa vazia.
- **Imagens no Flow** pelo Chrome automatizado voltaram "unusual activity". A saída foi a API Gemini (Nano Banana Pro).
- **Fala original com promessa de saúde** (GLP-1): o anúncio foi reescrito de forma honesta, com aprovação do Lukas. A versão enxuta avisa o editor antes de seguir.
- **Página do editor** (imagem + prompt + tempo "usar" por trecho):
  - no OrganicSet completo, `app/InstagramReferenceHub/scripts/pagina-editor.py`;
  - na versão enxuta, `scripts/pagina.py`.
- Detalhes técnicos de Windows/Flow em [windows.md](windows.md).
- Estado do anúncio La Baleine em `trabalhos/troca-caixa-bicarbonato/STATUS.md`.
