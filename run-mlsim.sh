#!/usr/bin/env bash
# GripSense ML Lab (Linux/macOS): ./run-mlsim.sh [port]   -> http://localhost:8100
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
PY="$ROOT/backend/.venv/bin/python"; [ -x "$PY" ] || PY=python3
exec "$PY" "$ROOT/mlsim/server.py" --port "${1:-8100}"
