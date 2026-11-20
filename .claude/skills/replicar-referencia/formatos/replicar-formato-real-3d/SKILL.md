---
name: replicar-formato-real-3d
description: Planejar transformação da referência real para 3D mantendo ângulo e estados no formato REAL→3D MESMO ÂNGULO. Usado pela skill geral replicar-referencia; a personalidade e a voz continuam ligadas ao personagem atual.
---

# Formato REAL→3D MESMO ÂNGULO

Ler `../../SKILL.md` e `../../references/personagem-e-formato.md`. O contrato atual recria o quadro em 3D; a transformação não autoriza mudar a ação ou o enquadramento.

1. Conferir plano, altura, orientação, movimento, posição e escala dos elementos, incluindo estados anteriores/posteriores da ação.
2. Recriar o quadro e seus objetos no tratamento 3D aprovado. Quando houver pessoa visível, aplicar a identidade do contact sheet. Um inserto sem pessoa mantém essa composição.
3. Preservar perspectiva, objetos, contato, recortes e causalidade. Detalhes de mãos não ganham rosto/corpo por conveniência. Não importar a roupa da pessoa original para o personagem.
4. Para fala em quadro, aplicar a interpretação vocal desse personagem e a fala aprovada. Trechos mudos e insertos mantêm sua política de áudio e montagem.
5. Se o trabalho pedir morfose entre real e 3D, conferir a rota de first/last frame suportada ou registrar a transição em edição; não simular suporte com um prompt. Conferir a correspondência espacial entre os estados.

Entrega: quadro 3D e identidade vinculados, estados/câmera preservados, fala/áudio por shot, duração e eventual transição de edição. Retornar à execução comum.
