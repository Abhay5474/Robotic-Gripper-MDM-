# Sample Firebase RTDB data

`firebase_sample_data.json` is a complete Realtime Database export you can import, with every kind of record the app reads and writes. It was **produced by running the real application workflow** (prediction → test → confirm → invalidate → operations) with a fixed clock and fixed ids, not written by hand, so it is exactly what the backend stores. A test regenerates it and fails if the file drifts from the code.

> **All values are illustrative.** The "LLM" predictions are labelled `sample-llm-v1 (illustrative, not a real model output)`, objects use the placeholder presets, and the gripper is the demo gripper (`demo-parallel-gripper`, 1–40 N). Nothing here is a validated force for a real gripper.

## What is in it

Top-level branches (the database root):

| Branch | Records | Written by |
|---|---|---|
| `grip_predictions/` | 8 immutable LLM recommendations | backend |
| `grip_calibrations/` | 11 calibration sessions of every status | backend |
| `active_calibrations/` | 7 index entries (6 usable + 1 invalidation tombstone) | backend (transactions) |
| `operations/` | 10 pick-and-place runs, one with a recorded trace | backend |
| `gripper_telemetry` | the live sensor node | **hardware team** |

Scenarios, one per object, each chosen to exercise a behaviour:

| Object | What is stored | What the app does with it |
|---|---|---|
| Plastic bottle | Two calibrations: 9.0 N (`sensor_assisted`) then a recalibration 9.5 N (`manual`, `based_on_calibration_id`). Index points to the newer one (`version: 2`) | Loads **9.5 N**, no LLM call; history shows both and marks the active one |
| Aluminum can | LLM 9.62 N → calibrated 12.0 N | Loads 12 N, no LLM call |
| Wooden block | Calibrated 5.5 N **plus** a recalibration still `in_progress` (tested at 6.0 N) | Loads 5.5 N; the open session can be confirmed (index → `version: 2`) |
| Ceramic cup | Full test log: slip → damage risk → 4.5 N confirmed (`marginal`, with warnings) | Loads 4.5 N and shows the "below recommended margin" warning |
| Steel bracket (custom object) | LLM 19 N → slip → 22 N confirmed, `sensor_assisted` | Loads 22 N |
| Fragile object | Only a `failed` session | **Not reused**: LLM is queried ("not yet calibrated") |
| Rubber ball | Calibrated, then `invalidated` ("pads replaced"); index holds a tombstone | **Not reused**: LLM is queried, with the reason shown |
| Cardboard box | Calibrated **400 days** before the sample date, plus a `cancelled` session | **Not reused** (stale > `CALIBRATION_MAX_AGE_DAYS`); the old value is shown but not applied |

Fields are exactly the schema in [`docs/FIREBASE_INTEGRATION.md`](../docs/FIREBASE_INTEGRATION.md). Two RTDB behaviours are visible in the data and handled by the app: `max_contact_force_n` is simply **absent** when unknown (RTDB does not store `null`), and empty arrays are absent.

## Importing

**Firebase console (simplest, for a scratch/test database):** Realtime Database → Data → ⋮ → *Import JSON* → pick the file at the root. ⚠ The console replaces data at the chosen location. Do **not** import over a database that holds real calibrations or the hardware team's telemetry. Also add `database.rules.json` (the `.indexOn` entries) for history queries.

**Command line (safer):** from `backend/` with `FIREBASE_*` configured:

```bash
python -m app.sample_data check ../samples/firebase_sample_data.json         # is it compatible with this app? (no writes)
python -m app.sample_data seed --dry-run                                     # show what would be written
python -m app.sample_data seed --prefix demo                                 # load into the demo/ namespace (visible in DEMO mode)
python -m app.sample_data seed                                               # load into the live root
```

`seed` validates first and refuses to write incompatible data; refuses to overwrite existing branches unless `--force`; **skips `gripper_telemetry`** unless `--include-telemetry` (the hardware team owns it); and by default **re-bases all timestamps** so the newest one is "now" (relative ages are kept, so the box stays stale). Use `--no-rebase` to keep the original dates.

**Without Firebase (development):** `make demo-sample`, or `STORE_BACKEND=memory LLM_PROVIDER=mock SEED_FILE=../samples/firebase_sample_data.json …` preloads it into the in-memory store (live root and `demo/`), timestamps re-based to now.

## Things to know

- **Dates.** The file's "now" is 2026-10-20 09:00 UTC. Imported without re-basing, the calibrations become *stale* (not reused) 365 days after they were confirmed, and `gripper_telemetry` is stale immediately (the hardware overwrites it). Re-basing via `seed` or `SEED_FILE` avoids both.
- **Keys depend on the gripper identity.** A configuration key hashes the gripper id, pad material, finger count, force definition and unit. If your backend uses a different `GRIPPER_ID` / `GRIPPER_CONTACT_PAD_MATERIAL` / `GRIPPER_FINGER_COUNT`, the sample is simply "not found" for you. Regenerate it for your gripper:
  `python -m app.sample_data generate --gripper-id my-gripper --pad-material rubber --fingers 2 --out my_sample.json`
- **Limits are checked on load, not keyed.** If your gripper's max force or an object's contact limit is lower than a stored force, that calibration is shown as "not applied (safety failed)".
- **Check your own export.** `python -m app.sample_data check export.json` validates any RTDB export (e.g., the hardware team's database) against everything this app reads: RTDB storage rules, record schemas, recomputed configuration keys, index↔record consistency, timestamps and test logs.
- **Demo namespace.** Demo-mode data lives under `demo/` with the same four backend branches (no telemetry). The sample file itself is the live root only.
