# GripSense AI with YOUR Firebase Realtime Database (project mdmproject123-8770f), for Windows.
#   - the backend stores predictions, calibrations and operations in Firebase (Admin SDK)
#   - the browser reads live telemetry from /gripper_telemetry in LIVE mode
# Needs the project's service-account key (a private file - never commit or share it):
#   Firebase console > Project settings > Service accounts > Generate new private key
# Put the downloaded JSON in the project folder (or backend\, or your Downloads folder) and run:
#   powershell -ExecutionPolicy Bypass -File .\run-firebase.ps1
# or point at it explicitly:  ... -File .\run-firebase.ps1 -Key D:\keys\my-key.json
param([string]$Key = '', [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dbUrl = 'https://mdmproject123-8770f-default-rtdb.firebaseio.com'

# --- find the service-account key
if (-not $Key) { $Key = $env:FIREBASE_CREDENTIALS_PATH }
if (-not $Key) {
  $dirs = @($root, (Join-Path $root 'backend'), (Join-Path $env:USERPROFILE 'Downloads'))
  $found = foreach ($d in $dirs) { if (Test-Path $d) { Get-ChildItem -Path $d -Filter '*firebase-adminsdk*.json' -File -ErrorAction SilentlyContinue } }
  $found = @($found | Sort-Object LastWriteTime -Descending)
  if ($found.Count -gt 0) { $Key = $found[0].FullName }
  elseif (Test-Path (Join-Path $root 'backend\firebase-key.json')) { $Key = Join-Path $root 'backend\firebase-key.json' }
}
if (-not $Key -or -not (Test-Path $Key)) {
  Write-Host 'No Firebase service-account key found.' -ForegroundColor Red
  Write-Host '  1. Firebase console > Project settings > Service accounts > Generate new private key'
  Write-Host '  2. Save the JSON in this folder (or Downloads), then run this script again.'
  Write-Host '     Or: powershell -ExecutionPolicy Bypass -File .\run-firebase.ps1 -Key C:\path\to\key.json'
  exit 1
}
$keyInfo = Get-Content $Key -Raw | ConvertFrom-Json
if ($keyInfo.project_id -ne 'mdmproject123-8770f') { Write-Host "Warning: this key is for project '$($keyInfo.project_id)', not mdmproject123-8770f." -ForegroundColor Yellow }
Write-Host "==> Using key $Key (project $($keyInfo.project_id))" -ForegroundColor Cyan

foreach ($tool in 'python', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool was not found. Install Python 3.11+ and Node.js 22 LTS, then open a new window." }
}

# --- backend packages, including firebase-admin
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { Write-Host '==> Creating backend\.venv' -ForegroundColor Cyan; python -m venv (Join-Path $root 'backend\.venv') }
Write-Host '==> Installing backend packages (with firebase-admin)' -ForegroundColor Cyan
& $py -m pip install --disable-pip-version-check -q -r (Join-Path $root 'backend\requirements.txt')
if ($LASTEXITCODE) { throw 'pip install failed' }

# --- frontend built WITH the Firebase web config (frontend\.env.production)
Push-Location (Join-Path $root 'frontend')
try {
  if (-not (Test-Path 'node_modules')) { npm install; if ($LASTEXITCODE) { throw 'npm install failed' } }
  Remove-Item env:VITE_FIREBASE_DISABLED -ErrorAction SilentlyContinue
  Write-Host '==> Building the frontend' -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE) { throw 'frontend build failed' }
} finally { Pop-Location }

# --- settings (process environment wins over backend\.env)
$env:STORE_BACKEND = 'firebase'
$env:FIREBASE_DATABASE_URL = $dbUrl
$env:FIREBASE_CREDENTIALS_PATH = (Resolve-Path $Key).Path
Remove-Item env:SEED_FILE -ErrorAction SilentlyContinue
if (-not $env:LLM_PROVIDER) { $env:LLM_PROVIDER = 'mock' }   # set LLM_PROVIDER/LLM_API_KEY in backend\.env for a real LLM
$env:FRONTEND_DIST = '..\frontend\dist'
$env:AUTH_MODE = 'none'
$env:COMMAND_CHANNEL = 'none'

# --- check the connection before starting, and say plainly what is wrong if it fails
Push-Location (Join-Path $root 'backend')
try {
  Write-Host "==> Checking the connection to $dbUrl" -ForegroundColor Cyan
  & $py -c "from fastapi.testclient import TestClient; from app.main import create_app; s=TestClient(create_app()).get('/api/health').json()['store']; import sys; print('CONNECTED to Firebase' if s['reachable'] else 'NOT CONNECTED: ' + str(s['error'])); sys.exit(0 if s['reachable'] else 2)"
  if ($LASTEXITCODE -eq 2) {
    Write-Host 'Firebase answered with an error. Check: the key belongs to mdmproject123-8770f, the Realtime Database exists, and this PC has internet access.' -ForegroundColor Red
    exit 1
  }
  if ($LASTEXITCODE) { throw 'The backend could not start with these Firebase settings (see the error above - usually an invalid key file).' }
  Write-Host "==> GripSense AI (Firebase) on http://localhost:$Port - Ctrl+C to stop" -ForegroundColor Green
  Start-Job -ScriptBlock { param($u) Start-Sleep 3; Start-Process $u } -ArgumentList "http://localhost:$Port" | Out-Null
  & $py -m uvicorn app.main:app_factory --factory --port $Port
} finally { Pop-Location }
