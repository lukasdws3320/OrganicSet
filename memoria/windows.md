# Computador do aluno: Windows 11

Instalado e adaptado em 06/11/2026. O pacote original é de Mac; aqui valem as versões Windows.

- Instalar: `instalar (Windows).bat`. Abrir o Hub: `Abrir Hub (Windows).bat`.
- `python3` = Python 3.12 do uv (`~/.local/bin/python3.exe`). O `python` do computador (3.9) não é usado pelo processo.
- `flow-control`: rodar pelo Python do browser-harness (`%APPDATA%\uv\tools\browser-harness\Scripts\python.exe`).
- browser-harness no Windows: porta + token em `~/.config/browser-harness/runtime/bu-default.port` (não socket). Sem `mac-approve`: o aluno clica em Permitir no Chrome.
- Adaptações no código: `app/GoogleFlowMCP/scripts/fcntl.py` (trava compatível), `scripts/plataforma.py` (abrir Chrome), `server/abrir.ts` no Hub (abrir pasta no Explorador).
- Avast define `SSLKEYLOGFILE=\\.\aswMonFltProxy...` e o browser-harness cai com "no OPENSSL_Applink". O `flow-control` já remove a variável; ao chamar `browser-harness` direto no PowerShell, rodar antes `Remove-Item Env:SSLKEYLOGFILE`.
- Chrome de geração: Chrome comum com pasta própria (ver [aluno.md](aluno.md)). `plataforma.py` lê `chromeExe` e `chromeUserDataDir` do connection.json (09/11/2026).
- Flow (09/11/2026), mudanças de interface já tratadas no controlador: chip "Agent" vem ligado (desligado antes de configurar); modelos com selo "Leaving Dec 5" (ignorado na comparação); Veo 3.1 sem seletor de duração/resolução (clipe fixo de 8 s, plano TROCA usa 8 s); download fica em `.crdownload` (aceito após 15 s parado, ainda validado por ffprobe).
- Imagens no Flow pelo Chrome automatizado voltaram "Failed · unusual activity" (sem cobrança); vídeos Veo passaram. Imagens agora saem pela API Gemini (Nano Banana Pro): `bun app/InstagramReferenceHub/scripts/gemini-image.ts --id REF--slug --item STILLnn`, chave em `~/.config/instagram-reference-hub/gemini.env` (aluno colocou). O Codex deste PC não tem a ferramenta de imagem.
- Veo 3.1 Quality custa 100 créditos por clipe de 8 s nesta conta (PRO); Veo 3.1 Fast custa 20. Os créditos são mensais (renovam dia 4), não diários: ver o saldo no menu da conta do Flow antes de cada lote. Falha do Flow não é cobrada.
- Falas de 2–3 s num clipe de 8 s voltaram "Audio generation failed" no Flow (10/11/2026); falas longas passaram.
- `hub.ts trocar-modelo --id ... --modelo "Veo 3.1 - Fast" --autorizacao ... --motivo ...` troca o modelo dos itens ainda não gerados da versão (aceita Fast e Lite). Padrão de modelo e pergunta de início ficam no AGENTS.md.
- Não funcionam no Windows: lembretes do app Lembretes (Apple) e o VoiceStudio.
