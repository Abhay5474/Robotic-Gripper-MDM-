# GripSense AI - fully offline demo for Windows (PowerShell).
# No Firebase, no LLM service, no API keys, no network services at runtime:
#   - in-memory database preloaded with samples/firebase_sample_data.json (reset on every start)
#   - "mock" physics heuristic instead of an LLM (clearly labelled in the UI)
#   - simulated gripper telemetry (DEMO mode)
# Any backend\.env or frontend\.env settings are overridden for this run.
#
# Usage (from the repository folder):
#   powershell -ExecutionPolicy Bypass -File .\run-offline.ps1
#   powershell -ExecutionPolicy Bypass -File .\run-offline.ps1 -Port 8080
param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

foreach ($tool in 'python', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found. Install Python 3.11+ and Node.js 22 LTS, then open a new PowerShell window." }
}

# --- backend: virtual environment with the offline requirements only (no firebase-admin)
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
  Write-Host '==> Creating backend\.venv' -ForegroundColor Cyan
  python -m venv (Join-Path $root 'backend\.venv')
}
Write-Host '==> Installing backend packages (offline set)' -ForegroundColor Cyan
& $py -m pip install --disable-pip-version-check -q -r (Join-Path $root 'backend\requirements-offline.txt')
if ($LASTEXITCODE) { throw 'pip install failed' }

# --- frontend: build once, served by the backend on the same port
Push-Location (Join-Path $root 'frontend')
try {
  if (-not (Test-Path 'node_modules')) { Write-Host '==> npm install' -ForegroundColor Cyan; npm install; if ($LASTEXITCODE) { throw 'npm install failed' } }
  # blank Firebase web config so the build can never connect to Firebase
  foreach ($v in 'VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_DATABASE_URL', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID') { Set-Item "env:$v" '' }
  $env:VITE_API_BASE = '/api'
  Write-Host '==> Building the frontend' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE) { throw 'frontend build failed' }
} finally { Pop-Location }

# --- offline settings (process environment wins over backend\.env)
$env:STORE_BACKEND = 'memory'
$env:LLM_PROVIDER = 'mock'
$env:SEED_FILE = '..\samples\firebase_sample_data.json'
$env:FRONTEND_DIST = '..\frontend\dist'
$env:AUTH_MODE = 'none'
$env:COMMAND_CHANNEL = 'none'

$url = "http://localhost:$Port"
Write-Host "==> GripSense AI (offline) on $url   - press Ctrl+C to stop" -ForegroundColor Green
Start-Job -ScriptBlock { param($u) Start-Sleep 3; Start-Process $u } -ArgumentList $url | Out-Null
Push-Location (Join-Path $root 'backend')
try { & $py -m uvicorn app.main:app_factory --factory --port $Port }
finally { Pop-Location }
