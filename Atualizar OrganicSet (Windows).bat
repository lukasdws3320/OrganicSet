@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo OrganicSet - atualizando com a versao mais nova do GitHub...
echo.
git pull --rebase --autostash
if errorlevel 1 (
  echo.
  echo [x] Nao deu para atualizar. Tire um print desta janela e mande para o Lukas.
) else (
  echo.
  echo [ok] OrganicSet atualizado. Se o Claude Code estiver aberto, feche e abra o VS Code.
)
echo.
pause
