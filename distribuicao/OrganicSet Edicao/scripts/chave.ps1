# Guarda a chave do Gemini (enviada pelo Lukas) fora desta pasta, só neste computador.
$pasta = Join-Path $env:USERPROFILE '.config\organicset-edicao'
$arq = Join-Path $pasta 'gemini.env'
Write-Host 'Cole a chave do Gemini que o Lukas te enviou e aperte Enter.'
Write-Host '(Ela não aparece na tela de propósito.)'
$seg = Read-Host -AsSecureString 'Chave'
$k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg)).Trim()
if ($k.Length -lt 20) { Write-Host 'Isso não parece uma chave. Confira com o Lukas e rode de novo.' -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force $pasta | Out-Null
[IO.File]::WriteAllText($arq, "GEMINI_API_KEY=$k`n", (New-Object Text.UTF8Encoding $false))
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1' -Headers @{ 'x-goog-api-key' = $k } -TimeoutSec 30
  Write-Host 'Chave salva e funcionando.' -ForegroundColor Green
} catch { Write-Host 'Chave salva, mas o Google recusou. Confira com o Lukas se ela está certa.' -ForegroundColor Yellow }
