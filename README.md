# GripSense AI

LLM-based gripping-force recommendation, **slider-based calibration on real hardware feedback**, and automatic reuse of calibrated forces via **Firebase Realtime Database**, for a two-finger parallel gripper.

```
LLM initial recommendation → physical test → slider adjustment → confirmed successful grasp
        → calibrated force saved to Firebase → reused automatically next time (no LLM call)
```

We are **not** training a model. An existing LLM API gives a starting point; the calibrated value comes from human-confirmed physical tests.

> **Safety.** Every force shown here is an *estimate* from a simplified friction model and an unvalidated LLM. The gripper limits shipped in this repo are **demo placeholders**. The hardware team must supply and validate real limits before this is used on a physical gripper. See [Safety limitations](#safety-limitations).

## Contents

- [Architecture](#architecture) · [Repository layout](#repository-layout) · [Setup](#setup) · [Environment variables](#environment-variables)
- [LLM provider](#configuring-the-llm-provider) · [Firebase](#configuring-firebase)
- [How prediction works](#how-force-prediction-works) · [Slider calibration](#how-slider-calibration-works) · [Saving](#how-successful-calibrations-are-saved) · [Reuse](#how-calibrated-forces-are-reused)
- [Safety limitations](#safety-limitations) · [Demo vs live mode](#demo-mode-and-live-mode) · [Testing](#testing)
- Docs: [docs/CALIBRATION_WORKFLOW.md](docs/CALIBRATION_WORKFLOW.md), [docs/FIREBASE_INTEGRATION.md](docs/FIREBASE_INTEGRATION.md)

## Architecture

```
┌──────────────── Browser (React + Vite + TS + Tailwind) ────────────────┐
│ Overview · Gripper Control · Object Selection · Force & Calibration     │
│ Live Telemetry · Calibration History · Settings                         │
│  • slider / safety checks (mirror of backend)   • R3F gripper view      │
│  • Firebase Web SDK: READ-ONLY telemetry listener (+ optional sign-in)  │
└───────────────┬───────────────────────────────────────┬─────────────────┘
                │ /api/* (HTTPS, optional bearer/ID token)│ onValue(gripper_telemetry)
┌───────────────▼─────────────── FastAPI backend ───────┐│
│ config key · safety · versioned prompt · LLM client    ││   ┌─────────────────────┐
│ Pydantic validation · calibration workflow · operations││   │ Hardware team       │
│ Firebase Admin SDK (privileged writes)  LLM key lives  ││   │ publishes telemetry │
│ ONLY here                                              ││   └──────────┬──────────┘
└───────────────┬───────────────────────────────────────┘│              │
                └──────────────► Firebase Realtime Database ◄────────────┘
        grip_predictions · grip_calibrations · active_calibrations · operations · gripper_telemetry
```

- **Secrets never reach the browser.** The LLM key and the Firebase service account exist only in the backend environment. The browser bundle contains only public Firebase web config.
- **The backend is authoritative** for safety limits, configuration keys, calibration state transitions and every privileged write. The frontend recomputes the safety status locally only so the slider reacts instantly; both implementations are verified against `shared/safety_cases.json`.
- **One database.** Firebase RTDB holds both live telemetry and persistent calibration records. No other database is used.

## Repository layout

```
backend/            FastAPI app (app/), tests (tests/), .env.example
frontend/           Vite + React app (src/), tests (tests/), .env.example
shared/             object_presets.json, safety_cases.json (shared by both sides and their tests)
docs/               FIREBASE_INTEGRATION.md, CALIBRATION_WORKFLOW.md
database.rules.json example RTDB security rules + indexes
```

## Setup

Requirements: Python 3.11+, Node 20+.

### Fastest path: no credentials (development only)

```bash
# terminal 1 - backend (in-memory store + offline heuristic instead of an LLM)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
STORE_BACKEND=memory LLM_PROVIDER=mock .venv/bin/uvicorn app.main:app_factory --factory --port 8000

# terminal 2 - frontend
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api to :8000)
```

The UI starts in **DEMO** mode. The header shows `LLM MOCK heuristic` and `RTDB reachable (memory, dev)` so this setup can never be mistaken for the real one. These two options are refused when `APP_ENV=production`.

### Real setup

1. `cp backend/.env.example backend/.env`, set `LLM_API_KEY`, `FIREBASE_DATABASE_URL`, and a service account ([below](#configuring-firebase)).
2. `cp frontend/.env.example frontend/.env` and fill the public `VITE_FIREBASE_*` values.
3. Start both as above, but without the `STORE_BACKEND`/`LLM_PROVIDER` overrides.
4. Apply `database.rules.json` (adjust to your project) and make sure the hardware team writes telemetry as described in [docs/FIREBASE_INTEGRATION.md](docs/FIREBASE_INTEGRATION.md).
5. Production build: `cd frontend && npm run build` (serve `dist/` behind the same origin as `/api`, or set `VITE_API_BASE` and `CORS_ORIGINS`).

## Environment variables

Backend (`backend/.env`, see `.env.example` for the full annotated list):

| Variable | Default | Meaning |
|---|---|---|
| `AUTH_MODE` | `none` | `none` (local dev), `bearer` (shared token), `firebase` (verify Firebase ID tokens). |
| `API_BEARER_TOKEN` | – | Required when `AUTH_MODE=bearer`. |
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `openai_compatible`, or `mock` (dev only, not an LLM). |
| `LLM_API_KEY` | – | Provider key. Backend only. |
| `LLM_MODEL` | `claude-sonnet-5-5` | Model id sent to the provider. |
| `LLM_BASE_URL` | provider default | Override for gateways / OpenAI-compatible servers. |
| `LLM_MAX_ATTEMPTS` | `2` | Attempts when the reply is malformed/invalid. |
| `STORE_BACKEND` | `firebase` | `firebase` or `memory` (dev only). |
| `FIREBASE_DATABASE_URL` | – | RTDB URL. |
| `FIREBASE_CREDENTIALS_PATH` / `FIREBASE_CREDENTIALS_JSON` | – | Service account (file path or JSON string). Secret. |
| `TELEMETRY_PATH` / `TELEMETRY_STALE_AFTER_S` | `gripper_telemetry` / `5` | Hardware node and staleness threshold. |
| `GRIPPER_*`, `LIFT_ACCELERATION_M_S2`, `HOLDING_SAFETY_FACTOR` | demo values | Force range, step, opening, friction-model inputs. `GRIPPER_LIMITS_SOURCE=hardware_team` once validated. |
| `CALIBRATION_MAX_AGE_DAYS` | `365` | Older calibrations are shown but not reused (`0` disables). |
| `ALLOW_SAFETY_OVERRIDE` | `false` | Allow saving a force below the estimated holding requirement, with a recorded reason. |
| `COMMAND_CHANNEL` | `none` | `rtdb` only after agreeing a command channel with the hardware team. |

Frontend (`frontend/.env`): `VITE_API_BASE`, `VITE_FIREBASE_API_KEY|AUTH_DOMAIN|DATABASE_URL|PROJECT_ID|APP_ID`, `VITE_TELEMETRY_PATH`. These are public by design.

## Configuring the LLM provider

- **Anthropic**: `LLM_PROVIDER=anthropic`, `LLM_API_KEY=…`, optionally `LLM_MODEL`.
- **OpenAI-compatible** (OpenAI, Azure gateways, vLLM, Ollama…): `LLM_PROVIDER=openai_compatible`, `LLM_BASE_URL=https://…/v1`, `LLM_API_KEY=…`, `LLM_MODEL=…`. The provider must support `chat/completions` with `response_format: json_object`.
- A missing key does not crash the server: `/api/health` reports `llm.configured=false` and prediction returns a clear `llm_not_configured` error.

## Configuring Firebase

1. Create a Realtime Database; note its URL.
2. Create a service account (Project settings → Service accounts → Generate key). Put the file **outside the repo** (git-ignored patterns exist) and point `FIREBASE_CREDENTIALS_PATH` at it, or pass the JSON via `FIREBASE_CREDENTIALS_JSON`.
3. Add the indexes/rules from `database.rules.json` (`grip_calibrations` needs `.indexOn: ["configuration_key","created_at_ms"]`).
4. For the browser (live telemetry), create a Web app and copy its public config into `frontend/.env`. If rules require auth, sign in from **Settings**.
5. Agree the telemetry contract with the hardware team: [docs/FIREBASE_INTEGRATION.md](docs/FIREBASE_INTEGRATION.md).

## How force prediction works

`POST /api/predict-grip` with the object's properties:

1. Normalise → deterministic **configuration key** (object id, mass, dimensions, material, friction, fragility, gripper identity & force definition; *not* the display name).
2. Look in `active_calibrations/{key}`. If a valid calibration exists → return it, **do not call the LLM**.
3. Otherwise render the versioned prompt (`force-estimate-v1`) and call the configured LLM. It must return JSON declaring `force_definition = normal_force_per_finger` and `force_unit = N`. The reply is validated with Pydantic and rejected (one retry, then a 502) if malformed, in another definition/unit, non-positive, or nonsensical (> 10× the gripper maximum). Nothing is ever fabricated.
4. Save the recommendation immutably under `grip_predictions/`.
5. Return the recommendation, the slider's initial value, and the safety assessment, labelled *Not yet calibrated*.

If Firebase is down the calibration check cannot run: the API returns `store_unavailable` and does **not** query the LLM, unless the user explicitly authorises "LLM only (calibration check skipped)". A browser-cached calibration can be offered only as clearly labelled *cached local data* after the safety checks pass again.

## How slider calibration works

On **Force & Calibration** the slider starts at the LLM value (or the saved calibration). The UI keeps four quantities separate: *LLM recommended*, *Selected target*, *Measured (actual)*, *Last calibrated*.

1. **Start test** creates a logged calibration session and records `test_started` at the selected force (rejected if infeasible).
2. Run the grasp on the gripper. Watch live telemetry.
3. Slipping → **Object slipping**, raise the force with the slider/±buttons, **Start test** again. Excess force or risk → **Damaged / at risk**, lower it. **Test failed**, **Cancel calibration** also available. Force is never raised automatically.
4. When it holds, **Confirm successful grasp** requires three explicit checkboxes (held and lifted · no slip · no damage). Reaching the target force is *not* treated as success.

The slider is a software target. Unless a hardware command channel has been agreed (`COMMAND_CHANNEL`), the UI says the physical gripper has **not** received the value.

## How successful calibrations are saved

`POST /api/calibrations/{id}/confirm` saves a *separate* record in `grip_calibrations/` (the LLM prediction is never modified) only if: the final force is the **most recent force actually tested** in that session; all three confirmations are true; the force passes the safety checks (no override unless policy allows and a reason is given); and fresh telemetry does not contradict the grasp (`slip_detected=true` blocks confirmation). The method is recorded as `sensor_assisted` only when fresh telemetry positively corroborates (force present, object detected, no slip), otherwise `manual`. Then `active_calibrations/{key}` is updated in a **transaction** (newest `confirmed_at_ms`, ties broken by id, wins). Failed/cancelled sessions are stored for diagnostics and never become active. Changing the force after success requires a new session.

## How calibrated forces are reused

Selecting the same configuration later hits step 2 above: the slider is populated with the saved value, the UI says **"Calibrated force loaded from Firebase."** and shows the date and record id, and the LLM is not called. A saved calibration is **not** silently reused when it is stale (older than `CALIBRATION_MAX_AGE_DAYS`), invalidated, inconsistent with its index entry, or fails the safety checks under the *current* limits (e.g., a tightened contact-force limit). In those cases the UI shows it as "not applied" and queries the LLM. **Regenerate** asks the LLM again without touching the saved value; **Invalidate** and **Recalibrate** are in Calibration History.

## Sample database records

`samples/firebase_sample_data.json` is a complete RTDB export (8 predictions, 11 calibration records in every status, 7 index entries, 10 operations, a telemetry node) generated by running the real workflow, plus `samples/README.md` explaining each scenario and how to import it. Check any export against this application with `python -m app.sample_data check FILE`, load the sample with `seed` (validates, re-bases dates, never overwrites without `--force`, skips hardware telemetry), or explore it without Firebase via `make demo-sample`. Tests regenerate it, validate it, run the whole API against it, and run the frontend's parsers on it.

## The console (UI)

**3D work-cell** (Gripper Control, Overview, Calibration, Telemetry, History replay)
- A table with a pick station and a place tray, a 4-axis arm, and a detailed two-finger parallel gripper: flange with a status LED ring, anodised housing, linear rail, carriages, fingers and silicone pads.
- Each object has its own shape and material, sized from its properties: PET bottle, aluminium can, wooden block, cardboard box, rubber ball, ceramic cup (with handle), glass vase.
- **What is real vs schematic.** Finger opening, measured force, slip and object detection come from telemetry (or the demo simulation). The **arm pose is schematic**: no telemetry reports it, so it is planned from `operation_state` with closed-form IK (`lib/kinematics.ts`, unit-tested), and the view says so.
- The object is carried only while it is detected, not slipping and actually clamped. On a slip it falls. Pads glow and force arrows grow with the *measured* force, and nothing is drawn without a measurement. Above the contact limit the object pulses red.
- **Camera.** Presets (whole cell, follow the gripper, front, side, top), drag to orbit, scroll to zoom, auto-rotate, PNG snapshot and full screen. Labels are projected from 3D (PICK/PLACE, the force tag at the pads, SLIP / OVER LIMIT).
- **Efficient rendering.** It draws on demand only while something changes, pauses when scrolled out of view, and lowers its resolution automatically if frames are slow. Without WebGL it falls back to the 2D free-body diagram.

**Engineering views**
- **Free-body diagram:** front view of the grasp with normal force N per finger, friction μN at each pad and the design load m(g+a), plus dimension lines. **Grip margin** = friction capacity ÷ design load = N / N_required (1.0 = estimated slip threshold, target = holding safety factor). It is shown for the selected and the measured force.
- **Force envelope**, **test-attempts chart**, **force gauge**, **operation-state timeline**, and **Insights** (LLM vs calibrated; operation outcomes).

**Workflow**
- **Calibration cockpit:**
  - a 5-step workflow stepper;
  - controls on the left, with the live 3D view, free-body diagram and safety checks on the right;
  - a **sticky action bar**, so Start test / Confirm / Slipping / Damage risk / Failed are always one click away;
  - an accessible confirm dialog;
  - **keyboard shortcuts**: `T` test, `C` confirm, `S` slipping, `D` damage risk, `F` failed, `←/→` adjust (Shift for coarse), `?` help. They are ignored while typing.
- **Calibration assistant:** suggests the next force after a slip or damage risk. It stays within limits and is never applied automatically.
- **Object gallery:** an illustrated card per preset with its calibration status (calibrated / stale / invalidated / not calibrated). It uses `POST /api/calibrations/lookup`, which never calls the LLM.

**App shell**
- **Command palette** (Ctrl/⌘ K): jump to pages, pick objects, switch mode or theme.
- **Navigation:** a collapsible sidebar with the current object, a breadcrumb header (each page keeps its own heading and browser-tab title), a drawer on phones (with the theme switch), toasts for saved results, and a skip link. Navigation commits immediately, even while a 3D scene is animating.
- **Telemetry:** pause/resume, 15 s / 30 s / 60 s / all windows, a stats strip (rate, min/mean/max force, time slipping) and the permitted band on the force chart.
- **History:** search, group by configuration, replay play/pause with the right object, CSV export of calibrations and JSON export of traces.
- **Light (faint red and white) / dark / system theme.** Chart and 3D colours follow the theme.
- `make demo | demo-sample | backend | frontend | test | serve`. `FRONTEND_DIST=../frontend/dist` serves the built app from the backend, and `.github/workflows/ci.yml` runs both test suites.

## Safety limitations

- Force limits, step, opening, lift acceleration and safety factor are **demo values** until `GRIPPER_LIMITS_SOURCE=hardware_team`. The UI labels them everywhere.
- The feasibility model is `N = m(g+a) / (n·μ)` with a margin. It ignores torque, pad compliance, dynamic loads, object deformation, and wrong friction estimates. A recommendation within the "estimated range" is not proof of safety.
- The LLM output is an unvalidated starting point; a model's self-reported confidence is shown but not trusted.
- One successful lift is not proof of safety under all conditions; calibrations are keyed to the exact properties and re-checked on load, and they can be invalidated.
- `manual` confirmations rely on the operator's judgement.
- The browser cannot move the gripper. Without an agreed, authenticated command channel the slider is only a software target.
- Timestamps are generated by the backend clock; telemetry freshness compares the hardware timestamp with the backend/browser clock, so clock skew can cause false stale/fresh readings.
- The Firebase integration is unit-tested against an in-memory emulation of the RTDB primitives and an adapter test; it has **not** been run against a live Firebase project or the RTDB emulator in this repository's CI.

## Demo mode and live mode

| | DEMO | LIVE |
|---|---|---|
| Telemetry | Software simulation in the browser, tagged `SIMULATED` | Firebase listener on `gripper_telemetry` |
| Storage | `demo/…` namespace in the same database | root branches |
| Hardware | None | Real gripper (observe it yourself) |
| Missing/stale data | Not applicable | Shown as *unavailable* / *STALE*; **never replaced by simulated values** |

The mode is switched only by the user (header toggle), and is locked while a calibration is in progress. Demo records are flagged `mode: demo` and carry a warning; they are never read in live mode.

## Testing

```bash
cd backend && .venv/bin/python -m pytest -q          # 132 tests, mocked Firebase + LLM
cd frontend && npm test && npm run typecheck && npm run build
```

Backend tests cover: first selection → LLM → slider default; adjusting and confirming; saved record separate from the untouched prediction; automatic reuse and **a spy proving no LLM call on a cache hit**; different mass/friction/object id never reuse; failed calibrations never active; infeasible/untested/unconfirmed forces rejected; Firebase and LLM failures; invalid LLM output; staleness; sensor-assisted vs manual confirmation; demo/live segregation; concurrent confirmations keeping the active index consistent; auth; provider request shapes. Frontend tests (140) cover the arm IK and motion planner, grip margin, the free-body diagram, the object gallery, the command palette, hotkeys, toasts, the workflow stepper, the 2D fallback of the 3D view, the shared safety cases, the calibration assistant, analytics/CSV, theme switching, the gauge and envelope, telemetry normalisation/staleness, form validation, the simulator, the decision-flow store (cases A/B/C, cached local data), the slider, and demo/live labelling.
