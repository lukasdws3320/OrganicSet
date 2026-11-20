#!/bin/bash
# Instala tudo o que o processo usa. Pode rodar de novo: só instala o que falta.
cd "$(dirname "$0")" || exit 1
RAIZ="$(pwd)"
ok(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
falha(){ printf "  \033[31m✗\033[0m %s\n" "$1"; FALHOU=1; }
echo ""; echo "OrganicSet — instalação"; echo ""
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# 1. Homebrew (pede a senha do Mac uma vez)
if ! command -v brew >/dev/null 2>&1; then
  echo "  Instalando o Homebrew. Ele vai pedir a senha do Mac (é normal)."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi
command -v brew >/dev/null 2>&1 && ok "Homebrew" || { falha "Homebrew"; }

# 2. Programas do processo
for f in python ffmpeg-full yt-dlp whisper.cpp pillow uv; do
  brew list "$f" >/dev/null 2>&1 || brew install "$f" >/dev/null 2>&1
  brew list "$f" >/dev/null 2>&1 && ok "$f" || falha "$f"
done
command -v ffmpeg >/dev/null 2>&1 || { [ -x /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg ] && ln -sf /opt/homebrew/opt/ffmpeg-full/bin/ffmpeg /opt/homebrew/opt/ffmpeg-full/bin/ffprobe /opt/homebrew/bin/ 2>/dev/null; }
command -v bun >/dev/null 2>&1 || curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1
export PATH="$HOME/.bun/bin:$PATH"; command -v bun >/dev/null 2>&1 && ok "bun" || falha "bun"
command -v browser-harness >/dev/null 2>&1 || uv tool install browser-harness >/dev/null 2>&1
command -v browser-harness >/dev/null 2>&1 && ok "browser-harness" || falha "browser-harness"

# 3. Agentes: Claude Code (análise dos vídeos) e Codex (imagens do ChatGPT)
command -v claude >/dev/null 2>&1 || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1
command -v claude >/dev/null 2>&1 && ok "Claude Code" || falha "Claude Code"
if command -v codex >/dev/null 2>&1 || [ -x /Applications/Codex.app/Contents/Resources/codex ] || [ -x /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex ]; then ok "Codex"
else brew install --cask codex >/dev/null 2>&1 && ok "Codex" || falha "Codex (instale o app do Codex)"; fi

# 4. Modelo de transcrição local (reserva quando não há chave do AssemblyAI)
MOD="$HOME/.local/share/instagram-reference-hub/models/ggml-small.bin"
if [ ! -s "$MOD" ]; then mkdir -p "$(dirname "$MOD")"
  curl -fsSL -o "$MOD" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin; fi
[ -s "$MOD" ] && ok "Modelo de transcrição" || falha "Modelo de transcrição"

# 5. Reference Hub e controlador do Flow
(cd app/InstagramReferenceHub && bun install >/dev/null 2>&1 && bun run build >/dev/null 2>&1) && ok "Reference Hub" || falha "Reference Hub"
(cd app/GoogleFlowMCP && bun install >/dev/null 2>&1) && ok "Controlador do Flow" || falha "Controlador do Flow"
chmod +x app/GoogleFlowMCP/scripts/flow-control "Abrir Hub.command" 2>/dev/null

# 6. Skills visíveis para Claude Code e Codex + painel
mkdir -p .agents; [ -L .agents/skills ] || { rm -rf .agents/skills; ln -s ../.claude/skills .agents/skills; }
ok "Skills ($(ls .claude/skills | wc -l | tr -d ' '))"
python3 scripts/painel.py >/dev/null && ok "Reference Hub.html"

echo ""
if [ -z "$FALHOU" ]; then echo "Pronto. Abra esta pasta no Claude Code e escreva: configurar"
else echo "Alguma coisa falhou (✗). Mande um print desta janela para o Matheus."; fi
echo ""; read -n 1 -s -r -p "Aperte qualquer tecla para fechar."
