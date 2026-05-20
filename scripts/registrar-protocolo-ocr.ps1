param(
  [switch]$Remove,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$protocol = "hubocr"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcher = Join-Path $projectRoot "INICIAR_OCR_HUB_PROCESSAR.cmd"
$registryKey = "HKCU:\Software\Classes\$protocol"
$cmd = Join-Path $env:SystemRoot "System32\cmd.exe"
$registryCommand = '"' + $cmd + '" /d /c ""' + $launcher + '" "%1""'

if ($ValidateOnly) {
  Write-Host "Projeto: $projectRoot"
  Write-Host "Launcher: $launcher"
  Write-Host "Comando de registro: $registryCommand"
  if (-not (Test-Path -LiteralPath $launcher)) {
    throw "Launcher nao encontrado: $launcher"
  }
  exit 0
}

if ($Remove) {
  if (Test-Path -LiteralPath $registryKey) {
    Remove-Item -LiteralPath $registryKey -Recurse -Force
    Write-Host "Protocolo $protocol removido deste usuario do Windows."
  } else {
    Write-Host "Protocolo $protocol nao estava registrado."
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $launcher)) {
  throw "Launcher nao encontrado: $launcher"
}

New-Item -Path $registryKey -Force | Out-Null
Set-Item -Path $registryKey -Value "URL:HUB OCR Local"
New-ItemProperty -Path $registryKey -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null

New-Item -Path "$registryKey\DefaultIcon" -Force | Out-Null
Set-Item -Path "$registryKey\DefaultIcon" -Value $launcher

New-Item -Path "$registryKey\shell\open\command" -Force | Out-Null
Set-Item -Path "$registryKey\shell\open\command" -Value $registryCommand

Write-Host "Protocolo hubocr:// registrado com sucesso."
Write-Host "Teste no Chrome abrindo: hubocr://rodar"
