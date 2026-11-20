# Abre o Reference Hub desta pasta em http://127.0.0.1:4317 (versão Windows do "Abrir Hub.command")
$ErrorActionPreference = 'Stop'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:PATH = "$env:USERPROFILE\.bun\bin;$env:USERPROFILE\.local\bin;$env:PATH"
$env:IRH_VAULT = $Raiz; $env:BRAIN_VAULT = $Raiz; $env:IRH_PERFIS = Join-Path $Raiz 'experts\perfis.json'
$env:IRH_ANGULO_MOTOR = 'claude'
$env:IRH_HARNESS_PYTHON = Join-Path $env:APPDATA 'uv\tools\browser-harness\Scripts\python.exe'
$env:PYTHONUTF8 = '1'
$env:IRH_TRANSCRICAO_IDIOMA = 'auto'   # perfis EUA (inglês) e Espanha (espanhol): o Whisper detecta o idioma da referência
# Avast define SSLKEYLOGFILE num pipe e derruba o OpenSSL do browser-harness
if ($env:SSLKEYLOGFILE -like '\\.\*') { Remove-Item Env:SSLKEYLOGFILE }
$Url = 'http://127.0.0.1:4317'

function HubNoAr { try { Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null; $true } catch { $false } }

if (HubNoAr) { Start-Process $Url; exit 0 }

$Logs = Join-Path $Raiz 'memoria\logs'; New-Item -ItemType Directory -Force $Logs | Out-Null
$App = Join-Path $Raiz 'app\InstagramReferenceHub'
Write-Host 'Preparando o Reference Hub...'
Push-Location $App
& bun run build *> (Join-Path $Logs 'hub-build.log')
Pop-Location
Start-Process -FilePath 'bun' -ArgumentList 'run','server/index.ts','--sem-retomar' -WorkingDirectory $App -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs 'hub.log') -RedirectStandardError (Join-Path $Logs 'hub-erros.log')

for ($i = 0; $i -lt 90; $i++) { if (HubNoAr) { break }; Start-Sleep -Seconds 1 }
if (HubNoAr) { Start-Process $Url } else {
  Write-Host 'O Hub não abriu. Veja memoria\logs\hub-erros.log ou mande este erro para o Matheus:'
  Get-Content (Join-Path $Logs 'hub-erros.log') -Tail 20 -ErrorAction SilentlyContinue
  Read-Host 'Aperte Enter para fechar'
}
