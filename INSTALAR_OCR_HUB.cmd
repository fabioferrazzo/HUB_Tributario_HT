@echo off
setlocal
title HUB Depto Tributario - Instalar OCR
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar-ocr.ps1" %*
echo.
pause
