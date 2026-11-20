@echo off
chcp 65001 >nul
echo Instalando o OrganicSet Edicao. Pode levar alguns minutos.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar.ps1"
echo.
pause
