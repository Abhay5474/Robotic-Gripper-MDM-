# Calibration workflow

How a configuration is identified, predicted, tested, saved, reused and retired.

## 1. Configuration key

`normalize_configuration()` (backend/app/config_key.py) builds:

```json
{"schema":"gripsense.config.v1","object_id":"plastic-bottle","mass_g":350.0,"width_mm":65.0,"height_mm":210.0,
 "depth_mm":65.0,"material":"pet plastic","friction_coefficient":0.4,"fragility":"moderate",
 "gripper":{"gripper_id":"…","finger_count":2,"contact_pad_material":"silicone",
            "force_definition":"normal_force_per_finger","force_unit":"N"}}
```

Key = `cfg_` + first 32 hex chars of `sha256(canonical JSON)` (sorted keys, compact separators).

- **Included:** object id, mass (0.1 g resolution), width/height/depth (0.1 mm), material (case/whitespace-normalised), friction coefficient (0.01), fragility, gripper id, finger count, pad material, force definition and unit.
- **Not included:** the display name (renaming does not change the key; a different `object_id` or any physical property does), and *limits* (gripper max force, object max contact force). Limits are re-checked on every load instead, so tightening one rejects reuse with an explicit reason rather than quietly creating a new key.
- Consequence: `350 g` vs `351 g`, or `μ 0.40` vs `0.41`, are different configurations. Values differing below the stated resolution are the same.

## 2. Prediction records (`grip_predictions/`)

Created only when the LLM is actually called, immutable afterwards. Contains the validated recommendation, the force definition/unit, the model identifier and `prompt_version` (`force-estimate-v1`). Never overwritten by calibration, regeneration creates a *new* record.

## 3. Resolution (what happens on selection)

```
predict(config) ─ key ─► active_calibrations/{key}
   ├─ valid ───────────► source=calibration, slider=saved force, LLM NOT called
   ├─ stale / invalidated / safety_failed / inconsistent ► shown as "not applied", LLM called
   ├─ none ────────────► LLM called → validate → save prediction → slider=LLM value, "Not yet calibrated"
   └─ Firebase down ───► error (no force). Optional explicit "LLM only" fallback, labelled "check skipped"
```

"Valid" means: the index entry points to an existing record with `calibration_status="calibrated"`, the same key, the same force definition/unit and force as the index, not older than `CALIBRATION_MAX_AGE_DAYS`, and the force passes the safety assessment (`ok` or `marginal`) under the **current** limits and properties.

## 4. Safety assessment

Per finger: `N_required = m·(g + a) / (finger_count · μ)`; recommended minimum = `N_required × holding_safety_factor`; upper limit = `min(gripper max, object max contact force if known)`.

| Status | Meaning | Test | Save as calibrated |
|---|---|---|---|
| `ok` | within [recommended min, upper] | yes | yes |
| `marginal` | ≥ required, < margin | yes | yes (warning stored) |
| `below_required` | < required (likely slip) | yes | only with override policy + reason |
| `below_minimum` | < gripper minimum | no | no |
| `exceeds_limit` | > gripper max or object contact limit | no | no |
| `no_safe_range` | required > upper limit, or the object is wider than the opening | no | no |
| `invalid` | non-finite/≤0, wrong definition or unit | no | no |

An infeasible force is never reported as safe. Results are estimates (see README safety limitations).

## 5. Calibration session and force adjustment

1. `POST /api/calibrations` → record `in_progress` (initial force, `prediction_id` / `based_on_calibration_id`; the original LLM force is read server-side from the prediction, not trusted from the client). Not active.
2. `POST /api/calibrations/{id}/tests` with `test_started` (rejected if `can_test` is false), `slipped`, `damage_risk` or `failed`. The log is ordered (`seq`) and snapshots live telemetry when available.
3. Adjust the force with the slider (UI), then log a new `test_started` at that force. Increments are configurable; the range is clamped to the gripper limits; the force never changes automatically.

## 6. Confirmation

`POST /api/calibrations/{id}/confirm` with `outcome`:

- `success` requires `final_force_n` and all of `held_and_lifted`, `no_slip`, `no_damage`. Server-side checks, in order: session still `in_progress`; **the most recent event is `test_started` at exactly `final_force_n`** (an untested or post-failure force is rejected with `untested_force`); safety assessment (`infeasible_force`, or `override_*` rules); telemetry (fresh `slip_detected=true` → `sensor_slip_detected`). Then the record becomes `calibrated`, with `confirmation_method` = `sensor_assisted` (fresh sensors corroborate) or `manual`, `sensor_summary`, `warnings`, `last_verified_at`; then the active index is updated transactionally.
- `failed` / `cancelled` close the session as diagnostics. The active index is untouched.
- Retrying a confirm on an already-`calibrated` record with the same force is idempotent and re-attempts the index update (covers a failure between the two writes).

If the force changes after success, a new session (recalibration) must test and confirm it.

## 7. Automatic reuse

Next selection of the same key returns `source=calibration`, the slider is set to the saved force, the UI shows "Calibrated force loaded from Firebase." with date and record id, the LLM is not called. Regeneration (`regenerate=true`) calls the LLM again without changing the saved calibration; the UI shows both values.

## 8. Invalidating and replacing

- **Replace:** confirm a new session for the same key; the index moves to the newest confirmation, older records stay for audit (the history marks which is active).
- **Invalidate:** `POST /api/calibrations/{id}/invalidate {reason}` sets `invalidated`, and clears the index **only if it still points to that record**. The next selection calls the LLM.
- **Recalibrate:** Calibration History → Recalibrate loads the stored properties, and a new session starts from the saved force; the existing calibration stays active until the new one is confirmed.
- Automatic non-reuse: staleness, tightened limits, changed properties (different key), inconsistent index.

## 9. Demo mode

All of the above works identically in demo mode under the `demo/` namespace with simulated telemetry. Records carry `mode: demo` and a warning; confirmation is always `manual`.
