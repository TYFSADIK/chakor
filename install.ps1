# ==============================================================================
#  Chakor installer for Windows (PowerShell).
#
#  Right click and "Run with PowerShell", or from a terminal:
#      powershell -ExecutionPolicy Bypass -File install.ps1
#
#  It installs what Chakor needs (Git, Node 20+, and Ollama for local models),
#  writes your config, builds the app, and starts it. Optional tools that fail
#  are skipped with a note instead of stopping the whole install.
#
#  Examples:
#      powershell -ExecutionPolicy Bypass -File install.ps1
#      powershell -ExecutionPolicy Bypass -File install.ps1 -NoOllama
#      powershell -ExecutionPolicy Bypass -File install.ps1 -NoStart
#      powershell -ExecutionPolicy Bypass -File install.ps1 -Help
#
#  A note on permissions: this does not force itself to run as Administrator or
#  weaken your machine. winget installs per-user where it can. The app runs as
#  you, not as SYSTEM.
# ==============================================================================

param(
  [switch]$Yes,
  [switch]$NoOllama,
  [switch]$NoStart,
  [switch]$Minimal,
  [switch]$Help
)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Say  ($m) { Write-Host $m -ForegroundColor Green }
function Step ($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Warn ($m) { Write-Host "!  $m" -ForegroundColor Yellow }
function Fail ($m) { Write-Host "x  $m" -ForegroundColor Red }

if ($Help) {
  @"
Chakor installer (Windows)

Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 [options]

Options:
  -Yes        Non-interactive. Assume yes.
  -NoOllama   Do not install Ollama.
  -Minimal    Only Node + the app. Bring your own model engine.
  -NoStart    Set everything up but do not start the app.
  -Help       Show this and exit.

Notes:
  - Installs Git, Node 20+, and (unless -NoOllama) Ollama via winget.
  - For GPU on Windows, just keep your NVIDIA driver current. For llama.cpp builds
    or LM Studio, see the README.
"@ | Write-Host
  exit 0
}

function Refresh-Path {
  $machine = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Have ($cmd) {
  return [bool](Get-Command $cmd -ErrorAction SilentlyContinue)
}

function Test-NodeOk {
  if (-not (Have "node")) { return $false }
  try {
    $major = (& node -p "process.versions.node.split('.')[0]") 2>$null
    return [int]$major -ge 20
  } catch { return $false }
}

# ---- find a package manager --------------------------------------------------
$HasWinget = Have "winget"
$HasChoco  = Have "choco"
if (-not $HasWinget -and -not $HasChoco) {
  Warn "Neither winget nor Chocolatey was found."
  Warn "winget ships with Windows 10/11 (App Installer). Update it from the Microsoft Store, or install Chocolatey from https://chocolatey.org/install"
}

# Install a package, trying winget then choco. Best effort: returns $true/$false.
function Install-Pkg ($wingetId, $chocoId) {
  if ($HasWinget -and $wingetId) {
    try {
      winget install -e --id $wingetId --accept-source-agreements --accept-package-agreements --silent
      Refresh-Path
      return $true
    } catch { Warn "winget could not install $wingetId." }
  }
  if ($HasChoco -and $chocoId) {
    try {
      choco install $chocoId -y
      Refresh-Path
      return $true
    } catch { Warn "choco could not install $chocoId." }
  }
  return $false
}

# ---- Git ---------------------------------------------------------------------
if (-not $Minimal) {
  if (Have "git") {
    Say "Git already installed."
  } else {
    Step "Installing Git"
    if (-not (Install-Pkg "Git.Git" "git")) {
      Warn "Could not install Git automatically. Get it at https://git-scm.com/download/win"
    }
  }
}

# ---- Node 20+ ----------------------------------------------------------------
if (Test-NodeOk) {
  Say "Node $(node -v) already present."
} else {
  Step "Installing Node 20+"
  if (-not (Install-Pkg "OpenJS.NodeJS.LTS" "nodejs-lts")) {
    Fail "Could not install Node. Get Node 20+ from https://nodejs.org and run this again."
    exit 1
  }
  if (-not (Test-NodeOk)) {
    Fail "Node was installed but is not on PATH yet. Open a new terminal and run install.ps1 again."
    exit 1
  }
  Say "Node $(node -v) ready."
}

# ---- Ollama (local models, no compiling) -------------------------------------
if (-not $Minimal -and -not $NoOllama) {
  if (Have "ollama") {
    Say "Ollama already installed."
  } else {
    Step "Installing Ollama (run local models with no compiling)"
    if (Install-Pkg "Ollama.Ollama" "ollama") {
      Say "Ollama ready. Pull a model any time with:  ollama pull llama3.2"
    } else {
      Warn "Could not install Ollama automatically. Get it at https://ollama.com/download (Chakor finds it once it runs). Or use LM Studio."
    }
  }
}

# ---- app dependencies --------------------------------------------------------
Step "Installing app dependencies"
npm install --legacy-peer-deps

# ---- config: .env.local with a generated AUTH_SECRET -------------------------
if (-not (Test-Path ".env.local")) {
  Step "Creating .env.local"
  Copy-Item ".env.example" ".env.local"
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $secret = [Convert]::ToBase64String($bytes)
  (Get-Content ".env.local") -replace "REPLACE_ME_WITH_openssl_rand_base64_32", $secret | Set-Content ".env.local"
  Say "Generated a random AUTH_SECRET. Add any model API keys to .env.local for cloud models."
} else {
  Say ".env.local already exists, leaving it as-is."
}

# ---- database + build --------------------------------------------------------
Step "Initializing database"
npm run init-db

Step "Building"
npm run build

# ---- go ----------------------------------------------------------------------
Write-Host "`n------------------------------------------------------------" -ForegroundColor Green
Say "Chakor is set up."
Write-Host "Open      http://localhost:3001   (first account you register is the admin)"
Write-Host "Config    edit .env.local to add cloud keys or rebrand"
Write-Host "------------------------------------------------------------" -ForegroundColor Green

if ($NoStart) {
  Say "Start it any time with:  npm start"
} else {
  Say "Starting Chakor on http://localhost:3001  (Ctrl+C to stop)"
  npm start
}
