---
name: configurar
description: Configura a pasta OrganicSet na primeira sessão ou quando algo muda — confere a instalação, faz as perguntas, liga o Claude Code e o Codex, prepara o perfil do Chrome só de geração, conecta a conta Ultra do Flow ao controlador e cria o expert no Reference Hub. Use quando o aluno disser "configurar", for a primeira conversa (memoria/aluno.md com status nao-configurado), ou quiser criar outro expert, trocar perfil do Chrome, conta do Flow, mercado ou nicho.
---

# Configurar a pasta

No fim: `memoria/aluno.md` com `status: configurado`, Hub abrindo, Claude Code e Codex logados, controlador do Flow na conta Ultra do aluno e o primeiro expert cadastrado. Uma pergunta por vez.

## 1. Instalação

```bash
command -v bun brew ffmpeg yt-dlp whisper-cli claude browser-harness; ls app/InstagramReferenceHub/node_modules >/dev/null && echo hub-ok
```

Faltou algo: o aluno dá dois cliques em `instalar.command` e volta. O agente não digita a senha do Mac.

## 2. Contas dos agentes (o aluno faz)

- **Claude Code** (análise dos vídeos): no Terminal, `claude` → entrar com a conta Claude (plano Pro ou maior). Conferir com `claude -p "ok" --model claude-sonnet-5-5` respondendo.
- **Codex** (imagens do ChatGPT): abrir o app do Codex e entrar com a conta do ChatGPT.
- **AssemblyAI** (opcional, transcrição melhor): o aluno cola a chave em `~/.config/instagram-reference-hub/assemblyai.env` como `ASSEMBLYAI_API_KEY=...` (`chmod 600`). Sem chave, o Hub usa o whisper local.

## 3. Perguntas (gravar em `memoria/aluno.md`)

1. Nome.
2. Mercado do Instagram: BR, Estados Unidos ou Espanha.
3. Idioma dos vídeos.
4. Nicho (receitas/comida, receita saudável/emagrecimento, receitas medicinais, ou o combinado com o Matheus).
5. Tema da CTA.
6. Avatar 3D ou realista.
7. Nome do perfil e do avatar, @ do Instagram.
8. Horários dos 3 posts do dia (padrão 10:00, 15:00, 20:00).

## 4. Flow: conta Ultra e perfil de geração

1. Compra da conta Ultra é do aluno; confirmar o e-mail.
2. O aluno cria no Chrome um perfil só para gerar vídeos, entra com o e-mail da Ultra e abre https://flow.google.com uma vez.
3. Achar a pasta interna desse perfil pelo nome que o aluno deu:

   ```bash
   python3 -c "import json,os;d=json.load(open(os.path.expanduser('~/Library/Application Support/Google/Chrome/Local State')))['profile']['info_cache'];[print(k,'=',v.get('name')) for k,v in d.items()]"
   ```

4. Gravar a conexão do controlador (sem senha, só conta e perfil):

   ```bash
   mkdir -p ~/.config/google-flow-mcp/state && python3 - <<'PY'
   import json, os, pathlib
   raiz = pathlib.Path.cwd()
   cfg = {"profileLabel": "Flow", "chromeProfile": "<pasta do perfil, ex.: Profile 2>", "accountEmail": "<e-mail da Ultra>",
          "apiPort": 8791, "readOnly": False, "stateDir": os.path.expanduser("~/.config/google-flow-mcp/state"),
          "outputDir": str(raiz / "app/GoogleFlowMCP/outputs"), "transport": "harness-ipc",
          "harnessSocket": os.path.expanduser("~/.config/browser-harness/runtime/bu-default.sock")}
   f = pathlib.Path(os.path.expanduser("~/.config/google-flow-mcp/connection.json")); f.write_text(json.dumps(cfg, indent=2)); f.chmod(0o600)
   PY
   ```

5. Ligar o browser-harness: `browser-harness --doctor`; se pedir permissão de depuração, `browser-harness mac-approve` e o aluno clica em Permitir.
6. Conferir sem gerar nada: `app/GoogleFlowMCP/scripts/flow-control status`. Tem de achar a aba do Flow na conta certa. Conta errada = parar e corrigir o perfil.

## 5. Expert

```bash
python3 scripts/novo-expert.py "Nome do Perfil" --personagem "Nome do Avatar" --instagram @perfil --mercado BR --idioma pt-BR --nicho receitas --estilo 3d --cta-tema "emagrecimento"
```

Cria `experts/<Nome>/` no modelo do Hub e registra em `experts/perfis.json`. Fechar e reabrir o Hub (`Abrir Hub.command`) para ele aparecer. No Hub, em Configurações → Agenda de posts, meta de 3 por dia com os horários escolhidos.

O contact sheet e a ficha de produção (`app/InstagramReferenceHub/library/experts/<personagem>/producao.json`, com projeto do Flow, modelo de vídeo e direção de voz) entram pela skill `expert-identidade-visual`, no formato que ela descreve.

## Windows

Mesmo processo, com estas trocas:

- Instalação: `instalar (Windows).bat` (scripts em `scripts/windows/`). Hub: `Abrir Hub (Windows).bat`. Conferir com `Get-Command bun,ffmpeg,yt-dlp,whisper-cli,claude,codex,browser-harness,python3`.
- Perfis do Chrome: `python3 -c "import json,os;d=json.load(open(os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data\Local State'),encoding='utf8'))['profile']['info_cache'];[print(k,'=',v.get('name')) for k,v in d.items()]"`
- `connection.json`: o mesmo script do passo 4, com `"harnessSocket"` apontando para `~/.config/browser-harness/runtime/bu-default.port` (no Windows o browser-harness usa porta + token, não socket). Sem `chmod`.
- Sem `mac-approve`: quando o Chrome perguntar sobre depuração remota, o aluno clica em Permitir.
- `flow-control`: `& "$env:APPDATA\uv\tools\browser-harness\Scripts\python.exe" app\GoogleFlowMCP\scripts\flow-control status`. Rodar só depois do `connection.json` existir; sem ele, o controlador abre o Flow no perfil `Default`.
- Lembretes do app Lembretes (Apple) e o VoiceStudio não existem no Windows; o resto do processo roda igual.

## 6. Fechar

`memoria/aluno.md` → `status: configurado` e data em "Instalação conferida em". Rodar `python3 scripts/painel.py`. Próximo passo: `instagram-aquecimento` e, em paralelo, `expert-identidade-visual`.
