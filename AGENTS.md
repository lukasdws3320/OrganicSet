# OrganicSet: replicação de conteúdo orgânico

Instruções para qualquer agente (Claude Code, Codex ou outro) aberto nesta pasta. `CLAUDE.md` só importa este arquivo. Converse em português do Brasil, com linguagem simples: o aluno não é programador. Diga o que vai fazer em uma frase e faça.

Este é o mesmo processo do Matheus Marcolino: o mesmo Reference Hub, o mesmo controlador do Flow e as mesmas skills, apontados para esta pasta e para a conta do aluno.

## Primeira coisa de toda sessão

1. Ler `memoria/aluno.md`. Com `status: nao-configurado`, rodar a skill `configurar` antes de qualquer outro pedido.
2. Ler `memoria/MEMORIA.md` (índice) e abrir só a memória que importa.
3. Identificar o expert/personagem do pedido em `experts/perfis.json`. Um só: usar. Vários: perguntar.

## Projeto novo: a pergunta de início

Todo vídeo novo que entra para produção (link, arquivo ou Drive) começa com esta pergunta, antes de importar ou analisar. Se o pedido já responde, não perguntar de novo.

1. **O que você quer?**
   - **Processo completo:** replicar a referência com o expert/avatar do aluno, pelo formato da referência (EXPERT, REACT etc.).
   - **Só uma alteração:** o vídeo fica igual e muda uma coisa. Pode ser trocar um objeto ou produto, acrescentar um objeto (na mesa, no ambiente), trocar a roupa da avatar atual, trocar a pessoa por uma avatar nova ou mudar parte do cenário. Formato TROCA DE PRODUTO (`replicar-referencia/formatos/replicar-formato-troca-produto`).
2. **Na alteração, até onde?**
   - **Até o vídeo pronto:** imagens, vídeos no Flow, conferência e edição, mais a página do editor. Foi o caso da caixa La Baleine.
   - **Só imagens e prompts:** analisar o vídeo base, gerar as imagens no Nano Banana, gerar os prompts e publicar a página HTML com a imagem e o prompt de cada trecho. Sem crédito de vídeo.

Depois da resposta, pedir só o que falta: o vídeo base e a imagem do que entra (produto, objeto, roupa, pessoa ou cenário).

Na alteração, gerar primeiro um **piloto de 3 imagens** (um trecho aberto, um close da alteração e o mais difícil) e esperar o OK antes de gerar o resto. Prompts de vídeo para Veo 3, Kling, Seedance 2.0 e MiniMax. Decisões e lições completas em `memoria/producao-anuncios.md`.

## Modelo de vídeo e créditos

- Padrão: **Veo 3.1 - Fast** (20 créditos por clipe de 8 s). É o equilíbrio custo × resultado decidido pelo Lukas em 10/11/2026. Na caixa La Baleine, o Fast saiu no nível do Quality (100 créditos).
- **Veo 3.1 - Lite** (10 créditos) só quando o aluno pedir, de preferência em trechos sem fala nem rosto. **Quality** só quando o aluno pedir.
- Os créditos do Flow são mensais (renovam dia 4). Ver o saldo no menu da conta antes de cada lote e montar o teto a partir dele.

## Mapa da pasta

| Caminho | O que é |
|---|---|
| `Abrir Hub.command` | Sobe o Reference Hub em http://127.0.0.1:4317 (importar, replicar, produzir, postar) |
| `Abrir Hub (Windows).bat`, `instalar (Windows).bat` | Versões Windows (scripts em `scripts/windows/`). No Windows: `python3` é o 3.12 do uv; `flow-control` roda como `"%APPDATA%\uv\tools\browser-harness\Scripts\python.exe" app\GoogleFlowMCP\scripts\flow-control <comando>` |
| `Reference Hub.html` | Painel rápido, sem servidor: abas Experts e Prompts. Atualizar com `python3 scripts/painel.py` |
| `app/InstagramReferenceHub/` | Reference Hub (código). Dados em `app/InstagramReferenceHub/library/` |
| `app/GoogleFlowMCP/` | Controlador do Flow (o agente que envia para o Flow). Saídas em `app/GoogleFlowMCP/outputs/` |
| `app/moldes/edicao-react-animacao/build.py` | Molde da edição React + Animação |
| `experts/<Nome>/` | Pasta de cada expert: `Contact Sheet/`, `Fotos/`, `06_roadmap/Postagens.md` (calendário), `07_entregas/videos-finais/` |
| `experts/perfis.json` | Cadastro dos experts que o Hub lê ao iniciar |
| `prompts/` | Prompts do processo (kit do avatar, pixel style, troca do avatar) e imagens de referência |
| `memoria/` | Configuração do aluno e decisões, uma por arquivo. Produção de anúncios e editores: `memoria/producao-anuncios.md` |
| `distribuicao/OrganicSet Edicao/` | Versão enxuta para os editores (só alteração pontual: imagens + prompts por IA). Pacote: `distribuicao/OrganicSet-Edicao.zip` |
| `trabalhos/` | Trabalhos avulsos (ex.: `troca-caixa-bicarbonato/`, com STATUS.md) |
| `.claude/skills/` | Skills (o Codex lê pelo atalho `.agents/skills`) |

## Qual skill usar

| Pedido | Skill |
|---|---|
| "configurar", primeira vez, novo expert, trocar conta do Flow ou perfil do Chrome | `configurar` |
| Criar/aquecer Instagram, proxy, celular, nicho, spy, separar vídeos | `instagram-aquecimento` |
| Criar avatar, contact sheet, fotos base | `expert-identidade-visual` |
| Link de Reel, importar, replicar, retomar produção, pacote para outro chat | `reference-hub` |
| Replicar vídeo: análise, formato, cadência, prompts, Flow, revisão | `replicar-referencia` (e seus módulos em `etapas/` e `formatos/`) |
| Trocar só uma coisa no vídeo (objeto, roupa, avatar, cenário) | `replicar-referencia/formatos/replicar-formato-troca-produto` |
| Página HTML para o editor (imagem + prompt de cada trecho) | `python3 app/InstagramReferenceHub/scripts/pagina-editor.py` (passo a passo na skill do formato), publicada como Artifact |
| Gerar/coletar no Flow ou no ChatGPT, aprovar imagens, edição | `replicar-referencia/etapas/execucao` |
| Carrossel | `replicar-carrossel` |
| Legenda V1/V2, CTA, palavra de comentário | `legenda-versoes` |
| Calendário, agenda, o que postar hoje | `calendario-postagens` |
| Transcrever áudio/vídeo | `transcricao-assemblyai` |
| Assistir/ler os quadros de um vídeo | `claude-video-main` |
| Qualquer coisa no navegador | `browser-harness` |

Carregar a skill antes de executar. Onde a skill citar o Hub ou uma CLI, rodar dentro de `app/InstagramReferenceHub` com o Hub aberto (`Abrir Hub.command`).

## Como o processo roda

- **Hub é a frente; os arquivos são a verdade.** Importar, preparar, executar e postar passam pela fila do Hub (`bun app/InstagramReferenceHub/scripts/hub.ts <comando>`), a mesma da tela.
- **Análise dos vídeos: Claude.** Duas leituras independentes (Opus e Sonnet) pelo Claude Code instalado no Mac. O aluno precisa estar logado no Claude Code.
- **Imagens: Codex ou Flow, decidido na hora de gerar.** `executar --gerador chatgpt` gera no ChatGPT pelo Codex e envia ao Flow; `--gerador flow` gera no Nano Banana dentro do Flow. Sem escolha no pedido, perguntar uma vez.
- **Vídeos: Flow (Veo 3, modo Frames)**, enviados pelo controlador em `app/GoogleFlowMCP`, no perfil do Chrome de geração e na conta Ultra do aluno.
- **Organização no Flow:** um projeto com o nome exato do expert e uma coleção com o ID da referência.
- **Edição:** formato EXPERT usa `app/InstagramReferenceHub/scripts/editar-expert.py`; React + Animação copia o molde `app/moldes/edicao-react-animacao/build.py` para a pasta `edicao/montagem` da produção e ajusta clipes, falas e cores. Vídeo final em `experts/<Nome>/07_entregas/videos-finais/`.

## Aquecimento do perfil (primeiros 30 posts)

15 vídeos de referência, cada um com legenda V1 (original da referência) e V2 (diferente). 3 posts por dia. Blocos de 2 dias: vídeos 1–6 com V1 nos dias 1–2 e com V2 nos dias 3–4; vídeos 7–12 com V1 nos dias 5–6 e V2 nos dias 7–8; vídeos 13–15 com V1 no dia 9 e V2 no dia 10. CTA pedindo para seguir o perfil. Na agenda do Hub (Configurações → Agenda de posts), meta de 3 posts por dia com os horários de `experts/<Nome>/ficha.json`.

## Regras

- **Tudo dentro desta pasta.** Nada em Downloads ou na Mesa.
- **Navegador** só pela skill `browser-harness`, no perfil do Chrome de geração, em aba de fundo. Nunca o perfil pessoal do aluno. Login, senha, código e compra: sempre o aluno.
- **Senhas e chaves nunca em arquivo** desta pasta nem no chat. Chave do AssemblyAI, se houver, fica em `~/.config/instagram-reference-hub/assemblyai.env`, colocada pelo aluno.
- **Créditos do Flow só com teto.** Confirmar o teto (`--creditos`) do primeiro lote de cada referência.
- **Não postar, comentar ou mandar DM** pelo aluno.
- **Sem inventar** número, depoimento ou promessa de saúde.
- **Estados separados:** preparado, gerado, conferido, aprovado pelo aluno e postado.
- Depois de mudar expert, contact sheet ou calendário: `python3 scripts/painel.py`.

## Memória

- `memoria/aluno.md`: configuração (perfil do Chrome, conta do Flow, mercado, nicho).
- Decisão confirmada pelo aluno que vale para as próximas sessões vira um arquivo em `memoria/` com uma linha em `memoria/MEMORIA.md`. Uma por arquivo; corrigir = editar a existente.
- Não guardar o que já está nos arquivos do expert, do Hub ou das skills.

## Origem

Skills e código do setup do Matheus Marcolino. Exemplos citados nas skills (perfis, REFs antigas) são da operação dele: servem de referência de método, não são perfis do aluno. Dúvida de método: perguntar ao Matheus.
