#!/usr/bin/env bash
# GripSense AI - fully offline demo for Linux/macOS. Same as run-offline.ps1:
# in-memory database with the sample data, mock heuristic instead of an LLM, simulated telemetry,
# no Firebase package, no keys, no network services. Overrides any backend/.env or frontend/.env.
# Usage: ./run-offline.sh [port]
set -euo pipefail
PORT=${1:-8000}
ROOT=$(cd "$(dirname "$0")" && pwd)
cd "$ROOT/backend"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements-offline.txt
cd "$ROOT/frontend"
[ -d node_modules ] || npm install
VITE_FIREBASE_API_KEY= VITE_FIREBASE_AUTH_DOMAIN= VITE_FIREBASE_DATABASE_URL= VITE_FIREBASE_PROJECT_ID= VITE_FIREBASE_APP_ID= \
  VITE_API_BASE=/api npm run build
cd "$ROOT/backend"
echo "==> GripSense AI (offline) on http://localhost:$PORT  - Ctrl+C to stop"
STORE_BACKEND=memory LLM_PROVIDER=mock SEED_FILE=../samples/firebase_sample_data.json FRONTEND_DIST=../frontend/dist \
  AUTH_MODE=none COMMAND_CHANNEL=none exec .venv/bin/python -m uvicorn app.main:app_factory --factory --port "$PORT"
