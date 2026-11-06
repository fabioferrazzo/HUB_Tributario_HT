# Instala o processador de OCR do HUB neste computador.
# Uso: clique com o botão direito em INSTALAR_OCR_HUB.cmd > Executar como administrador.
# O que faz:
#   1. Instala o Tesseract OCR e o LibreOffice (winget).
#   2. Acrescenta o idioma português ao Tesseract.
#   3. Instala o OCRmyPDF (Python), sem depender do Ghostscript.
#   4. Registra o atalho hubocr:// e a abertura do agente ao entrar no Windows.
#   5. Roda o diagnóstico.
param(
  [switch]$SemLibreOffice,
  [switch]$SemInicioAutomatico
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Etapa($texto) { Write-Host ""; Write-Host "== $texto" -ForegroundColor Cyan }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "Este instalador precisa ser executado como administrador." -ForegroundColor Yellow
  Write-Host "Clique com o botão direito em INSTALAR_OCR_HUB.cmd e escolha 'Executar como administrador'."
  exit 1
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget não encontrado. Atualize o 'Instalador de Aplicativo' pela Microsoft Store e tente de novo."
}

function Instalar-Winget($id, $nome) {
  $lista = winget list --id $id -e --source winget 2>$null | Out-String
  if ($lista -match [regex]::Escape($id)) {
    Write-Host "$nome já instalado."
    return
  }
  Write-Host "Instalando $nome..."
  winget install --id $id -e --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar $nome (código $LASTEXITCODE)." }
}

Etapa "1/5 Tesseract OCR"
Instalar-Winget "UB-Mannheim.TesseractOCR" "Tesseract OCR"

if (-not $SemLibreOffice) {
  Etapa "1/5 LibreOffice (conversão de DOCX, XLSX e PPTX em PDF)"
  Instalar-Winget "TheDocumentFoundation.LibreOffice" "LibreOffice"
}

Etapa "2/5 Idioma português do Tesseract"
$tessdata = "C:\Program Files\Tesseract-OCR\tessdata"
if (-not (Test-Path -LiteralPath $tessdata)) { throw "Pasta não encontrada: $tessdata" }
$por = Join-Path $tessdata "por.traineddata"
if (Test-Path -LiteralPath $por) {
  Write-Host "Português já disponível."
} else {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/tesseract-ocr/tessdata_fast/raw/main/por.traineddata" -OutFile $por
  Write-Host "Português instalado."
}

Etapa "3/5 OCRmyPDF"
$py = (Get-Command py -ErrorAction SilentlyContinue)
if (-not $py) { $py = Get-Command python -ErrorAction SilentlyContinue }
if (-not $py) { throw "Python não encontrado. Instale o Python 3.12 (winget install Python.Python.3.12) e rode de novo." }
& $py.Source -m pip install --user --upgrade "ocrmypdf>=17.13" pypdfium2
if ($LASTEXITCODE -ne 0) { throw "Falha ao instalar o OCRmyPDF." }
& $py.Source -m ocrmypdf --version

Etapa "4/5 Atalho hubocr:// e início automático do agente"
& (Join-Path $PSScriptRoot "registrar-protocolo-ocr.ps1")
if (-not $SemInicioAutomatico) {
  & (Join-Path $PSScriptRoot "registrar-agente-ocr-login.ps1")
}

Etapa "5/5 Diagnóstico"
Push-Location $ProjectRoot
try { node scripts/diagnose-arquivos-processador.mjs } finally { Pop-Location }

Write-Host ""
Write-Host "Instalação concluída. Para usar agora, abra INICIAR_OCR_HUB.cmd (ou saia e entre de novo no Windows)." -ForegroundColor Green
