@echo off
setlocal
title HUB Depto Tributario - Agente OCR

cd /d "%~dp0"

echo.
echo ================================================
echo  HUB Depto Tributario - Agente OCR local
echo ================================================
echo.
echo Este agente permite que o botao "Rodar OCR" do HUB
echo execute a conversao/OCR neste computador.
echo.
echo Deixe esta janela aberta enquanto usar o HUB.
echo Para encerrar, pressione Ctrl+C e confirme.
echo.

npm run arquivos:agent

echo.
echo O agente OCR foi encerrado.
pause
