@echo off
chcp 65001 >nul
cd /d "%~dp0"
where claude >nul 2>nul || (echo O Claude Code ainda nao esta instalado. Rode o Instalar.bat primeiro. & pause & exit /b)
claude
