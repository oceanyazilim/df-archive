<#
  Imports the files that never go to git (.env.local, .data\) from the
  "usbicin-df" transfer folder (the name has a c-cedilla) into this project.
  An existing .env.local is backed up first. Secret values are never printed.

  Run:  powershell -ExecutionPolicy Bypass -File scripts/import-usb-secrets.ps1 [-Source <folder>]
#>

param([string]$Source)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# Folder name built from a char code so the script stays pure ASCII (PS 5.1 misreads BOM-less UTF-8).
if (-not $Source) { $Source = Join-Path (Split-Path -Parent $root) ("usbi" + [char]0x00E7 + "in-df") }

if (-not (Test-Path (Join-Path $Source ".env.local"))) {
  throw "No .env.local in '$Source'. Pass the folder with -Source."
}

$envPath = Join-Path $root ".env.local"
if (Test-Path $envPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Copy-Item $envPath "$envPath.$stamp.bak"
  Write-Host "Existing .env.local backed up: .env.local.$stamp.bak"
}
Copy-Item (Join-Path $Source ".env.local") $envPath -Force
Write-Host ".env.local imported." -ForegroundColor Green

$dataSource = Join-Path $Source ".data"
if (Test-Path $dataSource) {
  $dataTarget = Join-Path $root ".data"
  New-Item -ItemType Directory -Force $dataTarget | Out-Null
  Copy-Item (Join-Path $dataSource "*") $dataTarget -Recurse -Force
  Write-Host ".data\ imported." -ForegroundColor Green
}

# Names only, so it is clear which credentials arrived without showing any value.
$filled = Get-Content $envPath | Where-Object { $_ -match '^\s*([A-Za-z0-9_]+)\s*=\s*\S' } |
  ForEach-Object { ($_ -split '=', 2)[0].Trim() }
Write-Host "Variables with a value ($($filled.Count)):"
$filled | ForEach-Object { Write-Host "  - $_" }
