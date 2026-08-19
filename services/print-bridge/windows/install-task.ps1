param(
  [string]$ExecutablePath = (Join-Path $PSScriptRoot "..\build\hawsmash-print-bridge.exe"),
  [string]$TaskName = "HAWSMASH Print Bridge"
)

$ErrorActionPreference = "Stop"
$resolvedExecutable = (Resolve-Path -LiteralPath $ExecutablePath -ErrorAction Stop).Path
$workingDirectory = Split-Path -Parent $resolvedExecutable
$envFile = Join-Path $workingDirectory ".env"

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
  throw "Falta $envFile. Copia e preenche o .env antes de instalar."
}

$action = New-ScheduledTaskAction -Execute $resolvedExecutable -WorkingDirectory $workingDirectory
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -User "SYSTEM" `
  -RunLevel Highest `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Host "Tarefa '$TaskName' instalada e iniciada."
