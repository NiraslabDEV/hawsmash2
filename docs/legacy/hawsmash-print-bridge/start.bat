@echo off
REM Arranca o print-bridge. Usar no Agendador de Tarefas (ao arrancar o PC)
REM ou na pasta Arranque do Windows. Faz cd para a pasta do script primeiro.
cd /d "%~dp0"
node src/index.js
