param(
  [switch]$Remove,
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"

$TaskName = "HUB Depto Tributario - Agente OCR"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$StarterPath = Join-Path $ProjectRoot "INICIAR_OCR_HUB.cmd"

if (-not (Test-Path -LiteralPath $StarterPath)) {
  throw "Arquivo iniciador nao encontrado: $StarterPath"
}

if ($ValidateOnly) {
  Write-Host "OK: script valido. Iniciador encontrado em $StarterPath"
  exit 0
}

if ($Remove) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Agendamento removido: $TaskName"
  } else {
    Write-Host "Nenhum agendamento encontrado para remover."
  }
  exit 0
}

$Action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$StarterPath`""
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel LeastPrivilege
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 12)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null

Write-Host "Agendamento criado: $TaskName"
Write-Host "O agente OCR sera aberto ao fazer login no Windows."
