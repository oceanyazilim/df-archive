<#
  Ocean Distro Finder - secure local environment setup.

  Writes credentials ONLY to .env.local. Never prints secret values, never
  sends anything over the network, and creates a timestamped backup before
  replacing an existing file. Unrelated existing variables are preserved.

  Run:  powershell -ExecutionPolicy Bypass -File scripts/setup-env.ps1
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env.local"

function Read-Secret([string]$prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---- Load existing .env.local (preserve unrelated variables) ----
$env = [ordered]@{}
if (Test-Path $envPath) {
  foreach ($line in Get-Content $envPath) {
    if ($line -match '^\s*#') { continue }
    if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') { $env[$Matches[1]] = $Matches[2] }
  }
}

# Canonical defaults for non-secret keys (only set if absent).
$defaults = [ordered]@{
  NODE_ENV = "development"
  APP_NAME = "Ocean Distro Finder"
  APP_URL = "http://127.0.0.1:3000"
  SOUNDCHARTS_ENABLED = "true"
  SOUNDCHARTS_BASE_URL = "https://customer.api.soundcharts.com"
  SOUNDCHARTS_TOKEN_URL = "https://account.soundcharts.com/oauth/token"
  SOUNDCHARTS_TEAM_ID = "fyapar-api"
  SOUNDCHARTS_USE_LEGACY_AUTH = "false"
  SOUNDCHARTS_REQUEST_TIMEOUT_MS = "15000"
  SOUNDCHARTS_MAX_RETRIES = "3"
  SOUNDCHARTS_CACHE_TTL_SECONDS = "900"
  SOUNDCHARTS_CONCURRENCY = "5"
  SOUNDCHARTS_MAX_REQUESTS_PER_MINUTE = "1000"
  SPOTIFY_API_ENABLED = "true"
  UUID_MAPPING_PATH = "json/uuid's.json"
  LOOKUP_HISTORY_ENABLED = "true"
  LOOKUP_HISTORY_MAX_ITEMS = "100"
  LOOKUP_REQUEST_TIMEOUT_MS = "30000"
  LOOKUP_MAX_BATCH_SIZE = "100"
}
foreach ($k in $defaults.Keys) { if (-not $env.Contains($k)) { $env[$k] = $defaults[$k] } }

Write-Host "Ocean Distro Finder - secure environment setup" -ForegroundColor Cyan
Write-Host "Values are written only to .env.local. Secrets are never displayed.`n"

$configured = New-Object System.Collections.Generic.List[string]

$scId = Read-Host "Soundcharts Client ID"
if ($scId) { $env["SOUNDCHARTS_CLIENT_ID"] = $scId; $configured.Add("SOUNDCHARTS_CLIENT_ID") }

$scSecret = Read-Secret "Soundcharts Client Secret (hidden)"
if ($scSecret) { $env["SOUNDCHARTS_CLIENT_SECRET"] = $scSecret; $configured.Add("SOUNDCHARTS_CLIENT_SECRET") }

$scTeam = Read-Host "Soundcharts Team ID (optional, press Enter for default 'fyapar-api')"
if ($scTeam) { $env["SOUNDCHARTS_TEAM_ID"] = $scTeam; $configured.Add("SOUNDCHARTS_TEAM_ID") }
elseif (-not $env["SOUNDCHARTS_TEAM_ID"]) { $env["SOUNDCHARTS_TEAM_ID"] = "fyapar-api"; $configured.Add("SOUNDCHARTS_TEAM_ID (default)") }

$spEnabled = Read-Host "Enable Spotify metadata fallback? (y/N)"
if ($spEnabled -match '^(y|yes)$') {
  $env["SPOTIFY_API_ENABLED"] = "true"
  $spId = Read-Host "Spotify Client ID"
  if ($spId) { $env["SPOTIFY_CLIENT_ID"] = $spId; $configured.Add("SPOTIFY_CLIENT_ID") }
  $spSecret = Read-Secret "Spotify Client Secret (hidden)"
  if ($spSecret) { $env["SPOTIFY_CLIENT_SECRET"] = $spSecret; $configured.Add("SPOTIFY_CLIENT_SECRET") }
}

if (-not $env["APP_SECRET"]) {
  $bytes = New-Object 'System.Byte[]' 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $env["APP_SECRET"] = [Convert]::ToBase64String($bytes)
  $configured.Add("APP_SECRET (generated)")
}

# ---- Backup then write ----
if (Test-Path $envPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  Copy-Item $envPath "$envPath.$stamp.bak"
  Write-Host "Backup created: .env.local.$stamp.bak"
}

$order = @(
  "NODE_ENV","APP_NAME","APP_URL","APP_SECRET",
  "SOUNDCHARTS_ENABLED","SOUNDCHARTS_BASE_URL","SOUNDCHARTS_TOKEN_URL","SOUNDCHARTS_CLIENT_ID","SOUNDCHARTS_CLIENT_SECRET","SOUNDCHARTS_TEAM_ID",
  "SOUNDCHARTS_USE_LEGACY_AUTH","SOUNDCHARTS_LEGACY_APP_ID","SOUNDCHARTS_LEGACY_API_KEY",
  "SOUNDCHARTS_REQUEST_TIMEOUT_MS","SOUNDCHARTS_MAX_RETRIES","SOUNDCHARTS_CACHE_TTL_SECONDS","SOUNDCHARTS_CONCURRENCY","SOUNDCHARTS_MAX_REQUESTS_PER_MINUTE",
  "SPOTIFY_API_ENABLED","SPOTIFY_CLIENT_ID","SPOTIFY_CLIENT_SECRET",
  "UUID_MAPPING_PATH","LOOKUP_HISTORY_ENABLED","LOOKUP_HISTORY_MAX_ITEMS","LOOKUP_REQUEST_TIMEOUT_MS","LOOKUP_MAX_BATCH_SIZE"
)
$lines = New-Object System.Collections.Generic.List[string]
foreach ($k in $order) { $v = if ($env.Contains($k)) { $env[$k] } else { "" }; $lines.Add("$k=$v") }
# Preserve any unrelated existing variables not in the canonical order.
foreach ($k in $env.Keys) { if ($order -notcontains $k) { $lines.Add("$k=$($env[$k])") } }

Set-Content -Path $envPath -Value $lines -Encoding UTF8

Write-Host "`n.env.local written." -ForegroundColor Green
Write-Host "Configured variables (names only):" -ForegroundColor Green
foreach ($name in $configured) { Write-Host "  - $name" }
Write-Host "`nNo secret values were displayed. Start the app with: npm run dev"
