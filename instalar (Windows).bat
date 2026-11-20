@echo off
rem Dois cliques: instala tudo o que o processo usa no Windows (versao Windows do instalar.command)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\instalar.ps1"
