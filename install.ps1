# ==============================================================
#  Chakor installer for Windows (PowerShell).
#
#  Right click and "Run with PowerShell", or from a terminal:
#      powershell -ExecutionPolicy Bypass -File install.ps1
#
#  Sorts out Node, installs everything, writes your config,
#  builds, and starts the app.
# ==============================================================
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Test-NodeOk {
  try {
    $major = (& node -p "process.versions.node.split('.')[0]") 2>$null
    return [int]$major -ge 20
  } catch { return $false }
}

if (Test-NodeOk) {
  Write-Host "Node $(node -v) found." -ForegroundColor Green
} else {
  Write-Host "Node 20+ not found. Installing via winget..." -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  } else {
    Write-Host "winget not available. Install Node 20+ from https://nodejs.org and run this again." -ForegroundColor Red
    exit 1
  }
  if (-not (Test-NodeOk)) {
    Write-Host "Could not verify Node after install. Open a new terminal and run install.ps1 again." -ForegroundColor Red
    exit 1
  }
}

Write-Host "Installing dependencies..." -ForegroundColor Green
npm install --legacy-peer-deps

if (-not (Test-Path ".env.local")) {
  Write-Host "Creating .env.local..." -ForegroundColor Green
  Copy-Item ".env.example" ".env.local"
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  (Get-Content ".env.local") -replace "REPLACE_ME_WITH_openssl_rand_base64_32", $secret | Set-Content ".env.local"
  Write-Host "Generated a random AUTH_SECRET. Add any model API keys to .env.local if you want cloud models." -ForegroundColor Green
}

Write-Host "Initializing database..." -ForegroundColor Green
npm run init-db

Write-Host "Building..." -ForegroundColor Green
npm run build

Write-Host "Starting Chakor on http://localhost:3001" -ForegroundColor Green
Write-Host "First account you register becomes the admin. Press Ctrl+C to stop." -ForegroundColor Green
npm start
