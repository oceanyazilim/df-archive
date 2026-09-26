<#
  Copies the Claude Code project memory shipped in docs/claude-memory/ into
  %USERPROFILE%\.claude\projects\<slug>\memory\ so Claude Code on a new PC
  starts with the same project notes. Never overwrites existing files.

  Run:  powershell -ExecutionPolicy Bypass -File scripts/restore-claude-memory.ps1
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root "docs\claude-memory"

# Claude Code names the project folder after its path: every non-alphanumeric
# character becomes "-" (C:\ocean-development\distro-finder -> C--ocean-development-distro-finder).
$slug = ($root -replace '[^A-Za-z0-9]', '-')
$target = Join-Path $env:USERPROFILE ".claude\projects\$slug\memory"

New-Item -ItemType Directory -Force $target | Out-Null

$copied = 0; $skipped = 0
foreach ($file in Get-ChildItem $source -Filter *.md) {
  $dest = Join-Path $target $file.Name
  if (Test-Path $dest) { $skipped++; continue }
  Copy-Item $file.FullName $dest
  $copied++
}

Write-Host "Claude memory -> $target" -ForegroundColor Cyan
Write-Host "Copied: $copied  Skipped (already present): $skipped"
