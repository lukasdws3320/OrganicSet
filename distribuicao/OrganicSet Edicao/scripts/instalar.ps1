# Instala o que o OrganicSet Edição precisa no Windows. Pode rodar mais de uma vez: o que já existe é pulado.
$ErrorActionPreference = 'Continue'
function Passo($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Tem($c) { [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function AtualizarPath { $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User') }

if (-not (Tem winget)) { Write-Host 'Este Windows não tem o winget. Atualize o "Instalador de Aplicativo" pela Microsoft Store e rode de novo.' -ForegroundColor Red; exit 1 }

Passo '1/5 Python'
if (Tem py) { Write-Host 'Já instalado.' } else { winget install -e --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements; AtualizarPath }

Passo '2/5 ffmpeg (corta e lê o vídeo)'
if (Tem ffmpeg) { Write-Host 'Já instalado.' } else { winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements; AtualizarPath }

Passo '3/5 Git (o Claude Code usa)'
if (Tem git) { Write-Host 'Já instalado.' } else { winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements; AtualizarPath }

Passo '4/5 Transcrição e download de vídeos'
& py -3 -m pip install --upgrade --quiet faster-whisper yt-dlp
if ($LASTEXITCODE -ne 0) { Write-Host 'Falhou a instalação do faster-whisper/yt-dlp. Mande um print desta tela para o Lukas.' -ForegroundColor Red }

Passo '5/5 Claude Code'
if (Tem claude) { Write-Host 'Já instalado.' } else { Invoke-RestMethod https://claude.ai/install.ps1 | Invoke-Expression; AtualizarPath }

Write-Host ""
$falta = @('py','ffmpeg','git','claude') | Where-Object { -not (Tem $_) }
if ($falta) { Write-Host "Ainda não encontrei: $($falta -join ', '). Feche esta janela, abra o Instalar.bat de novo e, se continuar, chame o Lukas." -ForegroundColor Yellow }
else { Write-Host 'Tudo instalado. Próximo passo: "Configurar chave.bat".' -ForegroundColor Green }
