.PHONY: setup backend frontend demo demo-sample test build serve sample sample-check

setup:            ## install backend + frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm install

backend:          ## API on :8000 using backend/.env
	cd backend && .venv/bin/uvicorn app.main:app_factory --factory --reload --port 8000

frontend:         ## Vite dev server on :5173 (proxies /api)
	cd frontend && npm run dev

demo:             ## API with NO credentials: in-memory store + offline heuristic (development only)
	cd backend && STORE_BACKEND=memory LLM_PROVIDER=mock .venv/bin/uvicorn app.main:app_factory --factory --port 8000

demo-sample:      ## like `demo`, preloaded with samples/firebase_sample_data.json (live + demo namespaces)
	cd backend && STORE_BACKEND=memory LLM_PROVIDER=mock SEED_FILE=../samples/firebase_sample_data.json .venv/bin/uvicorn app.main:app_factory --factory --port 8000

sample:           ## regenerate samples/firebase_sample_data.json from the real app workflow
	cd backend && .venv/bin/python -m app.sample_data generate

sample-check:     ## validate the sample (or FILE=export.json) against this application
	cd backend && .venv/bin/python -m app.sample_data check $(or $(FILE),../samples/firebase_sample_data.json)

test:             ## all automated tests
	cd backend && .venv/bin/python -m pytest -q
	cd frontend && npm test && npm run typecheck

build:            ## production frontend bundle
	cd frontend && npm run build

serve: build      ## single process: API + built frontend on :8000
	cd backend && FRONTEND_DIST=../frontend/dist .venv/bin/uvicorn app.main:app_factory --factory --port 8000
