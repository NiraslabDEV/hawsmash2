# Remove o arranque automatico do POS.
#
# Aceita tambem o nome antigo da tarefa ('HAWSMASH POS Kiosk'): o instalador
# deixou de trazer o nome de um cliente por omissao, mas os PCs onde ele ja
# correu continuam a ter a tarefa com o nome velho. Desinstalar tem de
# funcionar nos dois.
param([string]$TaskName = 'POS Kiosk')

$candidates = @($TaskName, 'HAWSMASH POS Kiosk') | Select-Object -Unique
$removed = $false

foreach ($name in $candidates) {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Arranque automatico do POS removido ($name)."
    $removed = $true
  }
}

if (-not $removed) {
  Write-Host 'Nao havia arranque automatico do POS configurado.'
}
