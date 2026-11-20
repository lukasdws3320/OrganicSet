---
name: transcricao-assemblyai
description: Transcreve áudio ou vídeo (aula, call, anúncio, VSL, Reels, swipe) em texto PT-BR/EN via API do AssemblyAI, gerando TXT, JSON e legenda SRT. Use quando o Matheus pedir "transcreve esse vídeo/áudio", "tira o texto desse anúncio/aula/call", "gera legenda/SRT", ou quando precisar do texto falado de uma mídia local ou URL pública antes de analisar copy. Fallback sem chave/sem internet: Whisper local.
model: haiku
---

# transcricao-assemblyai

Transcrição de mídia via API do AssemblyAI com um script só-stdlib (`scripts/transcrever.py`). Upload do arquivo local (ou URL pública direta) → job → polling → salva `<nome>.txt`, `<nome>.json` (palavras + timestamps) e `<nome>.srt`.

> [!warning] Chave
> A chave AssemblyAI vem **só** da variável de ambiente `ASSEMBLYAI_API_KEY` ou do `.env` desta skill (`chmod 600`, já no `.gitignore`; modelo em `.env.example`). **Nunca** colar a chave em nota, chat, argumento de linha de comando ou commit. Se ela aparecer em algum desses lugares, considerar vazada e pedir rotação.

## Passos

1. **Conferir a chave** (não gasta crédito): `python3 .claude/skills/transcricao-assemblyai/scripts/transcrever.py --check`. Se falhar, pedir ao Matheus pra preencher o `.env` ou exportar a variável — não pedir a chave no chat.
2. **Vídeo pesado?** Extrair só o áudio antes (upload menor): `ffmpeg -i video.mp4 -vn -ac 1 -b:a 64k audio.m4a`.
3. **Transcrever:** `python3 .claude/skills/transcricao-assemblyai/scripts/transcrever.py arquivo1.m4a arquivo2.mp4 --out "<pasta da operação>/transcricoes" --lang pt`
   - `--lang en` pra mídia em inglês · `--lang auto` pra detectar · `--speakers` separa falantes (calls, entrevistas, podcasts).
   - Rodou e caiu no meio? Rodar de novo com o mesmo `--out`: o `jobs.json` retoma sem reenviar.
4. **Levar pro vault:** o texto vai pra nota `<Título> — Transcrição.md` na pasta da operação dona (padrão do `04_Setups/VSLSet/`), com link pro hub. JSON/SRT ficam fora do vault ou em pasta de apoio, não como nota.
5. **Revisar nomes próprios e números** — o ASR erra marca, nome de expert e valores. Não "corrigir" a fala do expert além disso: transcrição é registro, não copy.

## Gotchas

- URL tem que ser link direto pro arquivo de mídia. YouTube/Instagram/Drive não servem direto: baixar primeiro (`yt-dlp`) ou usar `claude-video-main`/`video-summarize` quando a pergunta for sobre o conteúdo, não o texto literal.
- Custa por hora de áudio: em lote grande, confirmar o volume com o Matheus antes.
- Sem chave ou sem rede: `whisper audio.m4a --language pt --model medium` (Whisper local instalado).
