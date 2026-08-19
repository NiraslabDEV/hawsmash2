param([string]$TaskName = "HAWSMASH Print Bridge")

$ErrorActionPreference = "Stop"
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Tarefa '$TaskName' removida."
} else {
  Write-Host "A tarefa '$TaskName' não está instalada."
}
