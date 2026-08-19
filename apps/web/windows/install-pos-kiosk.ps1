param(
  [ValidatePattern('^https://')]
  [string]$PosUrl = 'https://staging.hawsmash.com/pos',
  [string]$TaskName = 'HAWSMASH POS Kiosk'
)

$edgeCandidates = @(
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) {
  throw 'Microsoft Edge não encontrado. Instala o Edge antes de configurar o POS.'
}

$arguments = "--kiosk `"$PosUrl`" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble"
$action = New-ScheduledTaskAction -Execute $edgePath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "POS configurado em kiosk para $PosUrl."
