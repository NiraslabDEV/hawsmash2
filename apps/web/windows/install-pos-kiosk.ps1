# Instala o POS em modo quiosque no PC de balcao.
#
# -PosUrl e obrigatorio de proposito: o endereco e da instalacao, nao do
# produto. Um valor por omissao aqui e um PC que arranca a apontar para a loja
# de outro cliente sem ninguem reparar (CLAUDE.md 18.3).
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://')]
  [string]$PosUrl,
  [string]$TaskName = 'POS Kiosk'
)

$edgeCandidates = @(
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe')
)
$edgePath = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edgePath) {
  throw 'Microsoft Edge não encontrado. Instala o Edge antes de configurar o POS.'
}

# --autoplay-policy: o toque de "chegou um pedido" tem de soar mesmo antes de
# alguém tocar no ecrã — um POS acabado de reiniciar não pode estar mudo.
$arguments = "--kiosk `"$PosUrl`" --edge-kiosk-type=fullscreen --no-first-run --disable-session-crashed-bubble --autoplay-policy=no-user-gesture-required"
$action = New-ScheduledTaskAction -Execute $edgePath -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "POS configurado em kiosk para $PosUrl."
