# OrganicSet - instalação no Windows (versão Windows do instalar.command). Pode rodar de novo: só instala o que falta.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Raiz
$script:Falhou = $false
function Ok($t) { Write-Host "  [ok] $t" -ForegroundColor Green }
function Falha($t) { Write-Host "  [x]  $t" -ForegroundColor Red; $script:Falhou = $true }
function Tem($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
$LocalBin = "$env:USERPROFILE\.local\bin"; $BunBin = "$env:USERPROFILE\.bun\bin"; $WhisperDir = "$env:LOCALAPPDATA\whisper.cpp"
function NoPath($d) { $p = [Environment]::GetEnvironmentVariable('Path','User'); if ($p -notlike "*$d*") { [Environment]::SetEnvironmentVariable('Path', "$p;$d", 'User') }; if ($env:PATH -notlike "*$d*") { $env:PATH = "$d;$env:PATH" } }
Write-Host ""; Write-Host "OrganicSet - instalação (Windows)"; Write-Host ""
NoPath $LocalBin; NoPath $BunBin

# 1. Programas básicos
if (-not (Tem ffmpeg)) { winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements | Out-Null }
if (Tem ffmpeg) { Ok 'ffmpeg' } else { Falha 'ffmpeg (feche e abra de novo depois de instalar)' }
if (-not (Tem yt-dlp)) { winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements | Out-Null }
if (Tem yt-dlp) { Ok 'yt-dlp' } else { Falha 'yt-dlp' }
if (-not (Tem uv)) { powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex" | Out-Null }
if (Tem uv) { Ok 'uv' } else { Falha 'uv' }

# 2. Python 3.12 só como "python3" (o "python" que já existir no computador não muda)
if (-not (Test-Path "$LocalBin\python3.exe")) {
  $tinhaPython = Test-Path "$LocalBin\python.exe"
  uv python install 3.12 --default 2>$null | Out-Null
  if (-not $tinhaPython -and (Test-Path "$LocalBin\python.exe")) { Remove-Item "$LocalBin\python.exe" -Force }
}
if (Test-Path "$LocalBin\python3.exe") {
  $py3 = & "$LocalBin\python3.exe" -c "import sys; print(sys.executable)"
  & "$LocalBin\python3.exe" -c "import PIL" 2>$null; if (-not $?) { uv pip install --system --python $py3 --break-system-packages pillow 2>$null | Out-Null }
  Ok 'python3 (3.12) + pillow'
} else { Falha 'python3' }

# 3. Bun, browser-harness, Claude Code, Codex
if (-not (Tem bun)) { powershell -c "irm bun.sh/install.ps1 | iex" | Out-Null }
if (Tem bun) { Ok 'bun' } else { Falha 'bun' }
if (-not (Tem browser-harness)) { uv tool install browser-harness 2>$null | Out-Null }
if (Tem browser-harness) { Ok 'browser-harness' } else { Falha 'browser-harness' }
if (-not (Tem claude)) { irm https://claude.ai/install.ps1 | iex | Out-Null }
if (Tem claude) { Ok 'Claude Code' } else { Falha 'Claude Code' }
if (-not (Tem codex)) { if (Tem npm) { npm install -g @openai/codex 2>$null | Out-Null } }
if (Tem codex) { Ok 'Codex' } else { Falha 'Codex (instale o Node.js e rode de novo)' }

# 4. Transcrição local (reserva quando não há chave do AssemblyAI)
if (-not (Tem whisper-cli)) {
  $zip = "$env:TEMP\whisper-bin-x64.zip"
  Invoke-WebRequest -Uri 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip' -OutFile $zip -UseBasicParsing
  Expand-Archive -Path $zip -DestinationPath $WhisperDir -Force
}
$wc = Get-ChildItem $WhisperDir -Recurse -Filter 'whisper-cli.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($wc) { NoPath $wc.DirectoryName; Ok 'whisper-cli' } elseif (Tem whisper-cli) { Ok 'whisper-cli' } else { Falha 'whisper-cli' }
$Mod = "$env:USERPROFILE\.local\share\instagram-reference-hub\models\ggml-small.bin"
if (-not (Test-Path $Mod) -or (Get-Item $Mod).Length -eq 0) { New-Item -ItemType Directory -Force (Split-Path $Mod) | Out-Null; Invoke-WebRequest -Uri 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin' -OutFile $Mod -UseBasicParsing }
if ((Test-Path $Mod) -and (Get-Item $Mod).Length -gt 0) { Ok 'Modelo de transcrição' } else { Falha 'Modelo de transcrição' }

# 5. Reference Hub e controlador do Flow
Push-Location app\InstagramReferenceHub; bun install *> $null; if ($?) { bun run build *> $null }; $hubOk = $?; Pop-Location
if ($hubOk) { Ok 'Reference Hub' } else { Falha 'Reference Hub' }
Push-Location app\GoogleFlowMCP; bun install *> $null; if ($?) { bun run build *> $null }; $flowOk = $?; Pop-Location
if ($flowOk) { Ok 'Controlador do Flow' } else { Falha 'Controlador do Flow' }

# 6. Skills visíveis para o Codex (atalho .agents\skills) + painel
$link = Join-Path $Raiz '.agents\skills'
$item = Get-Item $link -Force -ErrorAction SilentlyContinue
if (-not $item -or $item.LinkType -ne 'Junction') {
  if ($item -and -not $item.PSIsContainer) { Remove-Item $link -Force }
  if (-not (Test-Path $link)) { New-Item -ItemType Directory -Force (Join-Path $Raiz '.agents') | Out-Null; New-Item -ItemType Junction -Path $link -Target (Join-Path $Raiz '.claude\skills') | Out-Null }
}
Ok "Skills ($((Get-ChildItem (Join-Path $Raiz '.claude\skills') -Directory).Count))"
$env:PYTHONUTF8 = '1'; & "$LocalBin\python3.exe" scripts\painel.py | Out-Null; if ($?) { Ok 'Reference Hub.html' }

Write-Host ""
if (-not $script:Falhou) { Write-Host 'Pronto. Feche e abra o VS Code, abra esta pasta no Claude Code e escreva: configurar' }
else { Write-Host 'Alguma coisa falhou ([x]). Mande um print desta janela para o Lukas.' }
Write-Host ""; Read-Host 'Aperte Enter para fechar'
