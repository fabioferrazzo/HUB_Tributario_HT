@echo off
setlocal
title HUB Depto Tributario - Rodar OCR

cd /d "%~dp0"

echo.
echo ================================================
echo  HUB Depto Tributario - Processamento OCR local
echo ================================================
echo.
echo Este comando foi acionado pelo HUB via hubocr://rodar.
echo Ele processa os arquivos pendentes da biblioteca.
echo.

if not exist ".env.local" (
  echo ERRO: arquivo .env.local nao encontrado nesta pasta.
  echo Crie o .env.local local com as credenciais do Supabase antes de rodar OCR.
  echo.
  pause
  exit /b 1
)

npm run arquivos:process
set "exitCode=%ERRORLEVEL%"

echo.
if "%exitCode%"=="0" (
  echo OCR finalizado. Volte ao HUB e atualize a lista de Arquivos se necessario.
) else (
  echo OCR finalizado com erro. Revise as mensagens acima.
)
echo.
pause
exit /b %exitCode%
