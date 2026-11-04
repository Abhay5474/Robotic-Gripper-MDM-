# GripSense ML Lab (Windows): trains a grip-force model live on a synthetic dataset, on its own port.
# Pure Python standard library: no packages, no network. Runs alongside GripSense (port 8000).
# Usage:  powershell -ExecutionPolicy Bypass -File .\run-mlsim.ps1          (http://localhost:8100)
#         powershell -ExecutionPolicy Bypass -File .\run-mlsim.ps1 -Port 8200
param([int]$Port = 8100)
$ErrorActionPreference = 'Stop'
$py = Join-Path $PSScriptRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { $py = 'python' }
Start-Job -ScriptBlock { param($u) Start-Sleep 2; Start-Process $u } -ArgumentList "http://127.0.0.1:$Port" | Out-Null
& $py (Join-Path $PSScriptRoot 'mlsim\server.py') --port $Port
