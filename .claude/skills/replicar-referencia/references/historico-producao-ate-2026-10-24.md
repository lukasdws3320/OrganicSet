# Histórico de decisões específicas de produção

Consulta histórica; a execução atual segue SKILL.md e o perfil do expert. As preferências e exemplos de um expert não são defaults para os demais.

---
name: replicar-referencia
description: Replicar/modelar uma REF do Instagram Reference Hub por expert, com análise dupla obrigatória Watch/Claude Video + Gemini, mapa de estados versionado, shots/takes conferidos e prompts derivados por formato e engine. Use ao pedir clonagem, análise, versões de copy ou reparo de takes/stills/ângulo incorretos.
---

# Replicar referência — análise dupla e estado visual

Projeto canônico: `app/InstagramReferenceHub`. Ler `AGENTS.md` e `OPERACAO.md`. A biblioteca principal continua em Referências; Replicação é a área de produção por expert. Tudo é expert, inclusive operação própria.

## Produção organizada no Flow — 23/10/2026

Todas as coleções de REF ficam no mesmo nível, diretamente na raiz do projeto do expert. Antes de criar uma nova, voltar à Library/rota `/project/<id>`; a conferência final exige profundidade 0 e pai direto na lista raiz. Nome, URL e imagens corretos não comprovam essa hierarquia. Seguir o controlador atualizado, que bloqueia coleções aninhadas.

Um projeto Flow por expert/avatar, com o nome exato dele; uma coleção interna por vídeo, com o ID completo da REF. Reutilizar o projeto já renomeado pelo usuário e coleções existentes. Antes de upload/geração, `GoogleFlowMCP/scripts/flow-control ensure-collection --expert '<nome exato do projeto>' --reference <REF> --project <URL existente>` ou MCP `flow_organize_collection`. Confirmar cabeçalho da REF e URL `/project/<id>/collection/<id>`; todas as imagens, tentativas e gerações da referência ficam ali. Procedimento e campo `organization` do plano em `GoogleFlowMCP/docs/organizacao-flow.md`.

Quando o usuário pedir stills pelo Codex, gerar com a ferramenta nativa de imagem, usando contact sheet + frame do TAKE + ambiente aprovado. Uma imagem-base por setup inicial de SHOT; os estados intermediários permanecem referências opcionais. Guardar originais versionados em `<REF>/<slug>/gerados/<versão>/`, com REF/SHOT/TAKE/STILL nos nomes e manifesto de hashes/reutilizações. Enviar os arquivos prontos por `collection-upload` (ou MCP `flow_organize_collection` com `paths`), sem gerar outra imagem no Flow. Confirmar miniaturas e IDs dentro da coleção depois do processamento; upload no picker de ingredientes sozinho só comprova presença na biblioteca do projeto. Vídeos só entram na fase autorizada pelo pedido vigente.

Manter a direção expressiva anterior do Bruno. O teste de direção vocal física foi avaliado sem melhora relevante e não vira padrão. Este ajuste não altera a fala nem a entonação aprovada.

## Contrato

- SHOT = uma geração contínua; TAKE = momento/frame-âncora dentro dela, nunca geração automática por take. Preservar frase/oração contínua quando couber no preset da engine, mesmo com mudança visual ou vírgula. O limite de 24 palavras do contrato Veo não é regra universal de segmentação: Veo 3.1 vai até 8s; Omni Flash 1.1 aceita também 10s. Medir a fala e escolher duração pelo texto real, tempo da fonte e margem de dicção. REF-0001: a frase de 25 palavras entre 16,67–24,17s pertence a um só SHOT04/Omni 10s, com a aproximação da travessa em TAKEs internos.
- **Gate de cadência antes do Flow:** ler em voz alta a fala literal de cada geração na energia aprovada do expert e conferir a sequência dos TAKEs. Registrar duração da fonte, tempo estimado da fala, preset escolhido (4/6/8s no Veo Lite), palavras por segundo e motivo editorial em uma revisão de produção por REF. A janela do vídeo de origem orienta a montagem, mas não é piso para o clipe gerado; `max(janela, palavras/3.2)` não decide a duração. Escolher o menor preset que permita toda a fala com articulação e ação completas **sem esticar sílabas nem inserir pausas para preencher tempo**. Se dois SHOTs adjacentes formam uma locução contínua e cabem juntos, gerar uma vez e mapear os TAKEs internos. Se a fala não couber com clareza, revisar segmentação na fronteira natural da frase antes de pagar. O prompt deve mandar começar imediatamente, manter a cadência indicada e concluir a última palavra até o fim do preset; não pedir desaceleração para preencher segundos restantes. Após gerar, ouvir o clipe e comparar a cadência com a leitura de referência; duração técnica correta sozinha não aprova a fala.
- **Correção REF-2026-10-0005:** SHOT02 (“misture tudo muito bem… gruminho”) foi arrastado em 8s e deve ser refeito em **4s**, com TAKE02.1–02.5 no mesmo plano. SHOT07=4s; SHOT08=4s; SHOT09+SHOT10=uma única geração de 8s. As durações são decisões editoriais desta REF, não uma regra universal por quantidade de palavras.
- Abrir take em corte de câmera **e mudança física de estado**, mesmo em plano fixo: objeto entra/sai, mão segura/solta, contato, ingrediente despejado, preparo pronto. Antes/depois precisam de frame próprio quando mudam o estado.
- SETUP depende de câmera, props, pose e contato. Pixels parecidos não autorizam compartilhar still se os objetos/estado mudaram. Mesma pose/props/contato/câmera permite reaproveitar o still; a ação de cada shot continua própria.
- Ângulo do vídeo = plano, altura, orientação e movimento da câmera. Ângulo de copy = nome da versão V1/V2. Guardar em campos separados.
- Fala vem da versão escolhida; visual vem da referência. Copy literal: não corrigir imperfeições do Matheus. Número na fala exige revisão por extenso, sem modificar silenciosamente texto ou legenda. Não inventar prova, número, credencial, produto ou CTA do expert.

## Arquivos e fontes de verdade

`library/replicacoes/<REF>/` contém:

- `evidencias/watch.md`, frames timestampados do Watch e `evidencias/gemini.md` com as leituras Gemini. Logs de tentativas sem segredos.
- `analise.json`: schema versão 1 (`server/analise.ts`), hash do vídeo/fontes, data de revisão, mapa cronológico com ação/evento/pessoas/ângulo e estados (props, pose, mão direita/esquerda DA PESSOA, olhar, antes/depois e evidência de cada fonte).
- `shots.json`: versão 3, com hash da análise usada. Takes apontam ao frame correto, estado visual e still.
- `transcricao.json`: palavras originais do Whisper. Os tempos ASR são aproximados; a revisão pode realinhar as janelas às frases/ações observadas, sem descartar palavras nem cortar expressões.
- `<slug>/replicacao.json`: versão 3, derivada da análise. `replicacao.md` é entrega gerada, nunca fonte editada à mão. ID = `<REF>--<slug>`.

Avatar: arquivo `contactsheet<NomeAvatar><NN>` cadastrado em Experts. Uma contact sheet por avatar; nunca dois retratos separados no mesmo still.

## Fluxo obrigatório — uma REF por vez do início ao fim

1. **Preservar o anterior.** Em trabalho longo, escrever `GATES.md` antes de implementar (skill `unlazy`). Fazer backup das análises/prompts antes de reanalisar. Não carregar aprovação de geração de uma revisão anterior.
2. **Análise dupla.** Usar as duas ferramentas SEMPRE:
   - Watch / Claude Video (`claude-video-main`, upstream `bradautomates/claude-video`, versão instalada 0.3.2) com engine local e frames timestampados; os frames são conferidos pelo agente.
   - `video-summarize` / Gemini para ação temporal: o que cada mão segura, o que entra/sai, antes/depois, contato, evento, segunda pessoa, olhar e ângulo. Usar as duas leituras quando ambas retornam. Retentar 503/429; erro de chave/dependência exige correção, não repetição cega.
   - No Hub: botão **Analisar com Watch + Gemini**, ou `POST /api/replicacoes/<REF>/analisar`. O processo roda em background com retry. O estado `aguardando_conferencia` significa evidências prontas, **ainda sem aprovação de análise**.
   - CLI local: `python3 scripts/analisar-revisao.py <REF>`. `IRH_ANALYSIS_PYTHON` pode escolher o Python com as dependências. Nenhuma geração paga de imagem/vídeo é executada.
3. **Cruzar e salvar o mapa.** Ler Gemini e frames Watch. Discordância de mão/objeto/câmera deve ser resolvida nos frames, registrada em `incertezas` e nas decisões. Cada estado aponta a um frame real do Watch e a um trecho literal do relatório Gemini. Não apresentar hipótese do Gemini como pixel confirmado. O schema vivo é `server/analise.ts`; seguir o `analise.json` conferido da REF-0009 como exemplo de estrutura, nunca como modelo visual de outra REF.
4. **Importar o mapa conferido.** Na página, **Importar mapa conferido (.json)**; API `PUT /api/replicacoes/<REF>/analise` recebe o JSON completo. Valida cobertura cronológica, teto de fala, origem das duas fontes, hashes, arquivo do frame, janela e evidência. Salva histórico por hash e resegmenta. Mapa inválido não libera prompts. Alterar evidência/vídeo invalida a revisão.
5. **Segmentar.** `POST /api/replicacoes/<REF>/segmentar`. Com mapa: fronteiras de estado controlam os takes e a chave semântica controla o compartilhamento de stills. Sem mapa: só rascunho automático com transcrição/cortes e comparação de 96×168 pixels com veto regional, marcado pendente; não autoriza produção.
6. **Criar por expert.** `POST /api/replicacoes` com `ref`, `expert_id`, `formato`, `engine`. Exige análise conferida e contact sheet cadastrada. Cada still nasce do frame DESSE take; estados intermediários são referências opcionais e não novas gerações. Não referenciar outra REF para trocar o ângulo.
7. **Copy/engine/formato.** A página permite trocar engine/formato e editar V1/V2. `PATCH /api/replicacoes/<ID>/config` aceita esses campos e `copy`. Fala é aplicada em prompt, Markdown, instrução de legenda e narração de insertos. Legenda específica pode ser guardada em `versoes[].legendas` (ex.: algarismos); default = fala literal. Configuração nova limpa status de geração anteriores.
8. **Lint e gate.** `GET /api/replicacoes/<ID>` devolve `problemas`, `avisos` e `bloqueada`. Erros desabilitam copiar/exportar e marcar feito; o servidor também bloqueia exportação/status. Conferir todos os avisos antes da produção. `GET /api/replicacoes/<ID>.md?versao=V1` só exporta quando não há erros.
9. **Conferência final.** Para cada shot comparar início, mudanças de estado e final com os frames originais. Entregar tabela SHOT → janela → fala → TAKE(s) → STILL → ação → evento; explicar diferenças em relação ao anterior. Rodar os testes apropriados, TypeScript, build e abrir a aba Replicação no navegador. Resultado é análise/prompts produzidos e verificados; imagens/vídeos só se geram com pedido específico.

## Quatro playbooks fechados

| Formato | Still | Vídeo | Edição |
|---|---|---|---|
| EXPERT | Frame da própria REF + contact sheet; substituir a pessoa indicada em `quem`, manter composição e props. | Avatar executa a ação conferida do shot, câmera original e fala escolhida. | Cortes, legendas, @ e overlays da fonte. |
| REACT | Somente plate frontal do avatar com fundo simples/uniforme; frame serve para pose. | Reação própria do avatar por shot (`react_acao`, obrigatória para liberar a geração), fala literal; não manipula os objetos da referência. | Original fica por baixo; composição/split é pós. |
| RECEITA POV | Recriar alimentos, utensílios e mãos da referência; sem pessoa falante ou identidade do expert no quadro. | Preparo com ação/evento; geração sem fala. | Narração literal da versão, legendas e montagem por fora. |
| REAL→3D MESMO ÂNGULO | Recriar **todo o quadro** em animação 3D estilo Pixar (cenário e props incluídos), avatar na posição da pessoa, ângulo original explícito. | Mesma altura, recorte, enquadramento e movimento de câmera da REF; ação/estado próprios. | Elementos sobrepostos da fonte são pós. Se a fonte corta o rosto, manter o rosto fora do quadro. |

Não confundir o último formato com talking head frontal. Cena sem pessoa visível continua sem pessoa; não inventar o avatar num inserto de comida.

## Engines — o campo muda os templates

| Superfície | Still | Vídeo |
|---|---|---|
| Omni/Flow / Veo 3 | Nomes de arquivo: `@SHOTnn_TAKEnn.k.jpg` + `@contactsheet…`. Dois anexos quando há substituição de pessoa. Cada still é independente. | Uma imagem inicial; trajetória inteira no texto, sem slots posicionais. Presets pares do contrato. |
| Seedance 2.0 | Posicional: `@image1` avatar, `@image2` frame. No inserto/POV sem identidade, `@image1` é o frame. | `@image1` avatar + `@image2` still inicial; still final só na rota explicitamente suportada. Inserto/POV sem identidade usa o still em `@image1`. Duração inteira conforme janela/fala. |

Não anunciar compatibilidade de first+last na superfície Omni de imagem única. Morfose de forma exige rota declarada: edição (com `acao_geracao` no estado anterior) ou first+last com still final e engine compatível. Evento aditivo/fluxo físico entra no prompt. Não pedir que um still já final se transforme de novo.

## Leis de prompt e gate de geração

- Still enxuto: frase de substituição, deltas necessários e linha de remoção de texto **sobreposto**, preservando marcas/rótulos originais dos props. Não redescrever o cenário que o frame já carrega; no real→3D, declarar a conversão do quadro inteiro e a câmera.
- Still falado de rosto visível: boca fechada/neutra e olhar correspondente ao beat. Se o rosto está fora de quadro, não inventar olhos na lente. Mãos, contato e estado anterior precisam nascer corretos no still.
- **Um vídeo gerado = um plano, e o prompt precisa dizer isso.** O Omni/Veo criam várias cenas por padrão ("tenta criar um vídeo com algumas cenas diferentes"); para sair um take só, o prompt abre com **"Plano único ininterrupto, sem cortes de cena."** Sem essa frase, o modelo inventa corte no meio da fala. Fonte: guia oficial do Gemini Omni Flash (`ai.google.dev/gemini-api/docs/omni`, seção "Guia de comandos").
- **Ordem oficial dos blocos — cinematografia primeiro:** `[Cinematografia] + [Sujeito] + [Ação] + [Contexto] + [Estilo & ambiência]` (Google Cloud, "The ultimate prompting guide for Veo 3.1"). Movimento vago ("faça se mexer") rende resultado pior que movimento descrito com direção e tempo (guia oficial do Omni).
- Vídeo falado: fala literal entre aspas, ação e câmera da fonte. Para Bruno (decidido 22/10/2026): voz masculina adulta de **registro médio-grave, ressonância de peito**, **falando alto e projetando a voz**, com **empolgação e alegria genuína**, **ritmo agitado e acelerado** — energia alta combina com a personalidade dele. O que se pede junto, para não virar agudo: **sem agressividade, sem tom de briga, sem gritar de raiva, sem afinar a voz nem subir o tom no fim das frases**. (A regra anterior de "nunca pedir voz animada" caiu: o problema do lote de 21/10 foi voz aguda, não energia.) Bloco literal em `server/replicacao-prompts.ts` (`videoPrompt`). Fixar voz com `referenceAudio_N` quando disponível; atributo textual sozinho não trava timbre. Não citar sincronia labial, legenda/caption/subtitle no prompt. Música e efeitos fora.
- Produção de imagem Bruno: frame da REF + contact sheet em todo still, inclusive detalhes de mãos; três candidatas se a cotação viva de imagem for zero. Fixar jaqueta varsity azul-marinho, camiseta branca, calça comprida amarela, cozinha de madeira quente e bancada clara. Selecionar uma candidata por identidade, roupa, mãos, cenário e estado visual antes do vídeo pago. Produção automática: `dtcwinner-omni` e `GoogleFlowMCP/docs/flow-batch.md`.
- **Uma locução contínua = uma geração.** Vírgula, pausa curta e mudança de estado abrem TAKE dentro do shot, nunca shot novo. Só é fronteira de geração: fim de frase (`.!?…`), silêncio real (≥1s) ou corte de câmera. Gate mecânico: o lint emite `FALA_PARTIDA` — **erro** quando o trecho dividido está no mesmo setup (o take sai picotado), **aviso** quando atravessa setups diferentes (conferir se a fonte corta a câmera ali); a importação do mapa em `server/segmentar.ts` **rejeita** a fronteira quando a fala inteira caberia no envelope (10s/30 palavras). Foi o que partiu "…com uma textura de pudim," + "com sabor incrível…" no REF-2026-10-0001 em 21/10.
- Sem correção silenciosa de copy, credencial inventada, ação deduzida só da fala, hero genérico emprestado de outra REF, overrides ou still de outro take.
- Erros: ação duplicada; frame/take divergente; still compartilhado com estado diferente; ângulo real→3D ausente; fonte/hash desatualizado; janela fora da análise; fala acima do contrato; override legado; morfose sem rota. Avisos: ingrediente/ação citado sem correspondência visual e número na fala.
- Still com prop errado, contato rompido, mãos defeituosas ou estado final antecipado reprova antes de animar. Vídeo com câmera/ação errada ou fala cortada reprova. Reparar uma variável por vez. Beleza não substitui fidelidade.

## Dinamismo — clipe de IA sai morto (medido 22/10/2026)

Câmera fixa é o defeito nº 1 dos clipes gerados. Métrica objetiva, só ffmpeg (`scene_score` por frame, escala 0–1):

```bash
ffmpeg -v info -i clipe.mp4 -vf "scale=160:-2,format=gray,select='gte(scene,0)',metadata=print" -f null - 2>&1 \
  | grep -o "lavfi.scene_score=[0-9.]*" | cut -d= -f2 | python3 -c "
import sys; v=[float(x) for x in sys.stdin if x.strip()]; s=sorted(v)
print(f'frames {len(v)} | média {sum(v)/len(v):.4f} | p90 {s[int(len(s)*0.9)]:.4f}')"
```

Baseline do Bruno no reel (REF `DIgRFfPuJ7j`, 90s, 720×1280/30fps): **média 0,0219 · p90 0,0400**, 7 cortes de cena, fala a **2,46 palavras/s** com só 2,2s de pausa em 90s.
Os 8 clipes do REF-2026-10-0001 (gerados em 21/10): **0,0017–0,0072** — de 3× a 13× menos movimento que o original. É isso que faz o vídeo parecer parado.

Gate: clipe falado aprovado precisa de **média ≥ 0,010 e p90 ≥ 0,020**. Abaixo disso, regerar com direção de câmera explícita — não salvar por ser "bonito".

Consequência prática para o prompt: o texto de câmera precisa dizer o movimento em segundos do clipe (`push-in` nos primeiros 2s, `handheld` o tempo todo, `zoom` no beat do prop), e o still precisa já ter enquadramento com folga para o movimento.

Vocabulário que o modelo reconhece (empírico, 12.240 prompts reais — vflow.live/guides/camera-movements, 2026): `tracking` 27,1%, `close-up` 26,4%, `handheld` 20,9%, `wide shot` 14,7%, `orbit` 9,2%, `zoom` 7,5%, `push-in` 7,4%, `pull-out` 7,2%, `pan` 7,2%, `dolly` 2,7%, `whip pan` 1,9%, `crane` 1,8%, `static/fixed` 6%. `handheld` aparece junto de luz natural em 2,2× a taxa da base — é o termo que dá cara de UGC, não de publicidade.

Para dirigir movimento *dentro* do clipe, os dois engines aceitam marcação de tempo em linguagem natural ("aos 3 segundos a câmera fecha no rosto") e, no Omni, também timecode: `[0-3s] ... [3-6s] ...` (guia oficial). Usar quando o shot tem beat claro (aproximar no prop, voltar ao rosto).

**Um movimento só.** "O upgrade de realismo mais rápido é menos coreografia: um beat de ação + um movimento de câmera" (imaginary.app, 21/08/2026). Empilhar push-in + orbit + zoom no mesmo clipe lê como CGI. Os cinco defeitos que denunciam IA, por sintoma: pele plástica, física flutuante (sem peso/contato), cabelo-tecido-água com cara de gel, textura que não resolve, e **câmera lisa demais** — "a câmera perfeita de gimbal é um dos sinais mais claros de que o shot foi gerado, não filmado" (higgsfield.ai, 17/08/2026). Por isso `handheld` com microtremor entra como requisito, não enfeite.

**Não usar adjetivo inerte.** "Cinematic", "realistic", "high quality" não são instrução: o modelo não simula impressão. O que ele consegue executar é física e fonte de luz nomeada (janela, luminária, direção de onde a luz cai). Regra prática para o still falado: nomear a fonte de luz que **já existe** no frame, nunca inventar uma nova.

## Voz — o prompt não fixa timbre

O Omni/Veo sorteia a voz a cada geração: a fala literal está no prompt, o **timbre** não. O lote de 21/10 saiu com vozes diferentes entre clipes e uma aguda/afeminada. Três rotas, nesta ordem de preferência:

1. **Voz declarada na geração (`referenceAudio_N`)** — a rota certa. A API do Flow aceita `referenceAudio_N` (nome de preset — `Kore`, `Charon`, `Puck`, `Aoede`… — ou id de voz) junto de `referenceImage_N`/`character_N`, e o prompt aponta com `@referenceAudio_1`. Omni aceita até 5 vozes (vários falantes), Veo 3.1 Fast 1 voz — `veo-3.1-quality` não aceita voz; `startImage/endImage` não aceita voz. **Voz sem rosto é rejeitada.** Fixar a mesma voz + o mesmo still em todos os SHOTs do REF é o que dá timbre constante sem pós-produção.
   *Fonte: parâmetros do endpoint `/videos` do Flow (documentados no wrapper useapi do Google Flow), conferir no seletor de voz da UI ao anexar a imagem de referência.*
2. **Uma geração contínua por locução** — dentro de 8s (Veo) / 10s (Omni) a voz é coerente; `Extend` continua a mesma cadeia. Isso não conserta timbre entre SHOTs, mas evita troca de voz no meio da frase.
3. **Pós-produção com clone local (VoiceStudio)** — último recurso, e só sem esticar áudio. O piloto de 22/10 foi reprovado por isso: para caber no clipe, o `atempo` foi a 0,678x (SHOT05) e 0,652x (SHOT06) e a fala arrastou. **Regra: `atempo` < 0,90 reprova o clipe.** Se a voz clonada não couber em ±10% da janela, o problema é o recorte da cena (fala longa para o SHOT) — refazer a segmentação, não acelerar o áudio.

### Receita verificada (22/10/2026)

VoiceStudio `v0.5.6` em `/Applications/VoiceStudio.app`, engine `voxcpm2` (CPU; MPS não acelera), backend em `127.0.0.1:3900`.

1. **Referência de voz**: 20–30s de fala contínua, mono 24 kHz, sem música. Reel baixado com `yt-dlp -f bestaudio -x --audio-format wav`. Medir se tem música pela banda baixa (30–220 Hz ÷ 300–3400 Hz): `low/mid < 0,15` = fala limpa; acima disso, separar com o demucs do próprio venv do VoiceStudio (`-m demucs --two-stems=vocals -n htdemucs`).
2. **Perfil**: `POST /profiles` com `name`, `ref_audio`, `ref_text` (a transcrição exata do trecho, via `POST /transcribe`), `language=pt`, `kind=clone`.
3. **Fala conhecida (caso normal do Hub): `POST /generate`** com `text` = fala literal do mapa, `profile_id`, `duration` = duração da fala medida no áudio original (silencedetect, não a duração do clipe). Texto exato, sem ASR no meio — `/convert` introduziu palavra errada porque transcreveu "com sabor incrível" como "Vida com sabor incrível".
4. **Fala desconhecida**: `POST /convert` com `audio` + `profile_id` + `match_duration=true` (devolve `audio_url`).
5. **Remux**: posicionar no mesmo início da fala original e completar com silêncio — `adelay=<início>|<início>,apad=whole_dur=<dur do clipe>`, depois `-map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest`.
6. Script pronto: `scripts/trocar-voz.py`.

Tempo: ~65s para 4s de fala, ~142s para 6s (CPU). Um REF de 8 clipes ≈ 12 min. Piloto de 2 clipes antes do lote.

**Não** usar `/convert` como padrão nem trocar voz sem piloto escutado: conversão errada é indistinguível de geração ruim quando o problema é o modelo, não o timbre.

## Fontes operacionais

`WILLHAPPENED/02 - OP 001/.claude/skills/dtcwinner-video-director/` (leis, `analise-ref.md`, `omni.md`, `omni-bugs-e-fixes.md`, `imagem-nano-banana.md`, `seedance.md`, `qa-reparo.md`) e `dtcwinner-animapixar`. Decretos mais recentes revogam receitas antigas conflitantes (cadeia de stills, Voice Block e presets ímpares). No Hub, o pedido de análise dupla e formato real→3D prevalece sobre o playbook antigo Gemini-only. Não alterar a OP 001 nem o vault a partir deste projeto.
