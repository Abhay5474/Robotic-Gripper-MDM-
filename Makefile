.PHONY: setup backend frontend demo test build serve

setup:            ## install backend + frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm install

backend:          ## API on :8000 using backend/.env
	cd backend && .venv/bin/uvicorn app.main:app_factory --factory --reload --port 8000

frontend:         ## Vite dev server on :5173 (proxies /api)
	cd frontend && npm run dev

demo:             ## API with NO credentials: in-memory store + offline heuristic (development only)
	cd backend && STORE_BACKEND=memory LLM_PROVIDER=mock .venv/bin/uvicorn app.main:app_factory --factory --port 8000

test:             ## all automated tests
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm test && npm run typecheck

build:            ## production frontend bundle
	cd frontend && npm run build

serve: build      ## single process: API + built frontend on :8000
	cd backend && FRONTEND_DIST=../frontend/dist .venv/bin/uvicorn app.main:app_factory --factory --port 8000
