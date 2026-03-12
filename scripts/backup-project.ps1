$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $projectRoot "backups"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $backupDir ("GateGrave-bot-System-" + $timestamp + ".zip")

# Exclude the backup folder itself to avoid recursive zip issues.
$itemsToBackup = Get-ChildItem -Path $projectRoot -Force | Where-Object { $_.Name -ne "backups" }

# Only create a new backup when forward progress exists.
# Forward progress means at least one project file changed after the latest backup.
$latestBackup = Get-ChildItem -Path $backupDir -Filter "*.zip" -File -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$latestProjectChange = Get-ChildItem -Path $projectRoot -Recurse -File -Force |
  Where-Object { $_.FullName -notlike "$backupDir*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($latestBackup -and $latestProjectChange -and $latestProjectChange.LastWriteTime -le $latestBackup.LastWriteTime) {
  Write-Output "No forward progress detected. Backup skipped."
  exit 0
}

Compress-Archive -Path $itemsToBackup.FullName -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Output "Backup created: $zipPath"
