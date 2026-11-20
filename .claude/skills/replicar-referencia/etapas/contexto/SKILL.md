---
name: replicar-contexto
description: Resolver contexto, personagem, apresentação vocal e evidência visual de uma replicação antes de escolher formato ou preparar prompts.
---

# Contexto antes dos defaults

Ler a skill principal em `../../SKILL.md`. Trabalhar sobre a REF + expert + versão solicitadas.

1. Ler o pedido, a replicação e o material da personagem; abrir o contact sheet real. Identificar quem é substituído, partes visíveis, apresentação/idade vocal ampla, roupa, idioma e interpretação. Uma menina recebe direção infantil; uma mulher idosa recebe apresentação vocal de mulher idosa. Isso não determina automaticamente velocidade, fragilidade, sotaque ou uma idade numérica.
2. Separar três autoridades: a REF governa ação/câmera/estados; a personagem governa identidade/roupa/apresentação vocal; a versão aprovada governa palavras e direção específica. Preservar escolha explícita atual. Não transformar a mulher adulta da REF na idade da personagem nem o gênero cadastrado em prova de idade.
3. Resolver o que é observável sem questionário. Registrar em `copy.versoes[].direcao_voz` uma direção curta e coerente com a personagem (ex.: voz feminina infantil, clara e expressiva, ritmo natural). Anotar a fonte e se a conclusão é observada, informada ou inferida. Só perguntar quando fontes reais conflitarem ou o dado ausente mudar materialmente o resultado. Ambiguidade de idade permanece ampla; não inventar biografia.
4. Distinguir apresentação vocal de vínculo técnico. A direção infantil/idosa existe mesmo quando o usuário escolhe timbre livre, sem voz cadastrada. `voiceMention`/`voiceOption` pertencem ao perfil e dependem do modo. Por padrão são opcionais; a obrigatoriedade do Bruno é específica dele, não do Flow, Frames, DTC ou estilo 3D. Uma descrição não comprova clonagem. Não pedir novamente que o usuário escolha uma voz já dispensada.
5. Ler ../analise-visual/SKILL.md e conferir o vídeo com Watch + Opus/Sonnet 5.5 low e frames timestampados. Reaproveitar análise válida. Em cada evento relevante resolver: quem age, mão/objeto/contato, estado anterior e posterior, trajetória, enquadramento e fala correspondente. Um frame prova estado, não trajetória. Dúvida em ação fina ou transformação exige rever somente aquela janela; não refazer toda a análise por rotina.
6. Descrever primeiro como o vídeo funciona: quem fala e para quem, câmera/ângulo/olhar, áudio em quadro ou off, ação, cortes e composição. Identificar apresentador, reação, podcast, POV, demonstração, encenação incomum ou mistura observada. `3D`/`real` são estilos; DTC é contexto do conteúdo. Não deduzir olhar para a lente em podcast nem velocidade pela idade. Só depois carregar o módulo de formato correspondente. Formato ainda não mapeado permanece explícito para mapeamento próprio; não cair em EXPERT silenciosamente.
7. Fixar o destino comum Flow/Veo 3 do trabalho atual. Escolher Frames como preferência habitual, ou justificar Elements/Ingredients pela necessidade de múltiplas referências. A origem da imagem (Nano Banana/ChatGPT) não altera o formato nem obriga outra engine. Registrar modelo/modo, anexos e presets efetivamente disponíveis; isso vem depois da análise, antes do prompt final.

Concluído quando personagem/apresentação vocal, objetivo, formato, áudio e eventos físicos têm fonte e não conflitam. Em atualização de trabalho já enviado, preservar arquivos/hashes anteriores e preparar uma versão nova, conforme o controlador.
