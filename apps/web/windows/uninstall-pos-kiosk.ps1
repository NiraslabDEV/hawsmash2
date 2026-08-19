param([string]$TaskName = 'HAWSMASH POS Kiosk')

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host 'Arranque automático do POS removido.'
}
