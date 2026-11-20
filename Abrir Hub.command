#!/bin/bash
# Abre o Reference Hub desta pasta em http://127.0.0.1:4317
cd "$(dirname "$0")" || exit 1
RAIZ="$(pwd)"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export IRH_VAULT="$RAIZ" BRAIN_VAULT="$RAIZ" IRH_PERFIS="$RAIZ/experts/perfis.json"
export IRH_ANGULO_MOTOR=claude IRH_HARNESS_PYTHON="$HOME/.local/share/uv/tools/browser-harness/bin/python"
URL=http://127.0.0.1:4317
if curl -s -o /dev/null --max-time 2 "$URL"; then open "$URL"; exit 0; fi
mkdir -p memoria/logs
cd app/InstagramReferenceHub || exit 1
nohup bun run app:sem-retomada > "$RAIZ/memoria/logs/hub.log" 2>&1 &
for i in $(seq 1 90); do curl -s -o /dev/null --max-time 1 "$URL" && break; sleep 1; done
if curl -s -o /dev/null --max-time 2 "$URL"; then open "$URL"; else
  echo "O Hub não abriu. Veja memoria/logs/hub.log ou mande este erro para o Matheus:"; tail -20 "$RAIZ/memoria/logs/hub.log"
  read -n 1 -s -r -p "Aperte qualquer tecla para fechar."; fi
