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

# As opcoes acima so valem se o Edge arrancar do zero. Com o "arranque rapido"
# (ligado por omissao no Windows) fica um msedge.exe em segundo plano, o
# quiosque reaproveita-o e o --autoplay-policy e ignorado: o POS ve o pedido
# e fica calado. Aconteceu em Maputo (24 Set). Desliga-se o arranque rapido e
# fecha-se tudo o que for Edge antes de arrancar — este PC e so do POS.
try {
  $politica = 'HKLM:\SOFTWARE\Policies\Microsoft\Edge'
  New-Item -Path $politica -Force | Out-Null
  Set-ItemProperty -Path $politica -Name 'StartupBoostEnabled' -Value 0 -Type DWord
  Set-ItemProperty -Path $politica -Name 'BackgroundModeEnabled' -Value 0 -Type DWord
} catch {
  Write-Warning "Nao consegui desligar o arranque rapido do Edge (corre como administrador): $($_.Exception.Message)"
}
Get-Process -Name msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

Start-ScheduledTask -TaskName $TaskName
Write-Host "POS configurado em kiosk para $PosUrl."
