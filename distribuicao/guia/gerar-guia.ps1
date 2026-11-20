# Gera a página do guia com o .zip atual embutido (botão "Baixar"). Depois publique distribuicao\guia\guia-com-download.html
# no artifact https://claude.ai/artifact/TtuHgR8E7ssgRNSnasCXD2 (url), com root = distribuicao\guia, files = img/*, capabilities {downloads: true}.
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $aqui '..\OrganicSet-Edicao.zip')))
$t = [IO.File]::ReadAllText((Join-Path $aqui 'guia-modelo.html')).Replace('%%ZIP_B64%%', $b64)
[IO.File]::WriteAllText((Join-Path $aqui 'guia-com-download.html'), $t, (New-Object Text.UTF8Encoding $false))
'guia-com-download.html atualizado'
