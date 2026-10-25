"""FastAPI application: GripSense AI backend."""

import json
import secrets
from pathlib import Path
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import Settings, get_settings
from .llm import LLMClient, LLMError, UnconfiguredLLM, build_llm_client
from .prompts import PROMPT_VERSION
from .rtdb import FirebaseRtdb, MemoryRtdb, RtdbClient, RtdbError
from .schemas import (
    KEY_PATTERN,
    RECORD_ID_PATTERN,
    ConfirmRequest,
    ForceCommandRequest,
    InvalidateRequest,
    OperationRequest,
    PredictGripRequest,
    StartCalibrationRequest,
    TestEventRequest,
)
from .service import ApiError, Service
from .store import Store

PRESETS_FILE = Path(__file__).resolve().parents[2] / "shared" / "object_presets.json"


def create_app(settings: Optional[Settings] = None, db: Optional[RtdbClient] = None, llm: Optional[LLMClient] = None) -> FastAPI:
    settings = settings or get_settings()
    if settings.app_env == "production" and (settings.store_backend == "memory" or settings.llm_provider == "mock"):
        raise RuntimeError("In-memory store and mock LLM are development-only and cannot run with APP_ENV=production.")
    if settings.auth_mode == "bearer" and settings.api_bearer_token is None:
        raise RuntimeError("AUTH_MODE=bearer requires API_BEARER_TOKEN.")
    if settings.auth_mode == "firebase" and settings.store_backend != "firebase":
        raise RuntimeError("AUTH_MODE=firebase requires STORE_BACKEND=firebase.")

    if db is None:
        db = MemoryRtdb() if settings.store_backend == "memory" else FirebaseRtdb(settings)
    if settings.seed_file:
        if not isinstance(db, MemoryRtdb):
            raise RuntimeError("SEED_FILE can only be used with STORE_BACKEND=memory (it would overwrite a real database).")
        from .sample_data import load_into_memory
        load_into_memory(db, json.loads(Path(settings.seed_file).read_text()), settings.seed_namespaces, settings.seed_rebase)
    if llm is None:
        try:
            llm = build_llm_client(settings)
        except LLMError as e:
            llm = UnconfiguredLLM(e)
    service = Service(settings, Store(db, settings.telemetry_path), llm)

    app = FastAPI(title="GripSense AI", version="1.0.0")
    app.state.service = service
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
        allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type", "X-GripSense-Mode"],
    )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return JSONResponse(status_code=e.status, content={"detail": e.body()})

    # ------------------------------------------------------------ deps --
    def mode_dep(x_gripsense_mode: Annotated[str, Header()] = "live") -> str:
        if x_gripsense_mode not in ("demo", "live"):
            raise HTTPException(400, {"code": "bad_mode", "message": "X-GripSense-Mode must be 'demo' or 'live'."})
        return x_gripsense_mode

    def auth_dep(authorization: Annotated[Optional[str], Header()] = None) -> None:
        if settings.auth_mode == "none":
            return
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(401, {"code": "unauthorized", "message": "Bearer token required."}, headers={"WWW-Authenticate": "Bearer"})
        if settings.auth_mode == "bearer":
            assert settings.api_bearer_token is not None
            ok = secrets.compare_digest(token, settings.api_bearer_token.get_secret_value())
        else:
            from firebase_admin import auth as fb_auth
            try:
                fb_auth.verify_id_token(token)
                ok = True
            except Exception:
                ok = False
        if not ok:
            raise HTTPException(401, {"code": "unauthorized", "message": "Invalid token."}, headers={"WWW-Authenticate": "Bearer"})

    Mode = Annotated[str, Depends(mode_dep)]
    guard = [Depends(auth_dep)]

    # ---------------------------------------------------------- public --
    @app.get("/api/health")
    def health():
        store_ok, store_err = True, None
        try:
            service.store.ping()
        except RtdbError as e:
            store_ok, store_err = False, str(e)
        llm_configured = not isinstance(service.llm, UnconfiguredLLM)
        return {
            "status": "ok" if store_ok and llm_configured else "degraded",
            "version": app.version,
            "store": {"backend": settings.store_backend, "reachable": store_ok, "error": store_err,
                      "dev_only": settings.store_backend == "memory"},
            "llm": {"provider": settings.llm_provider, "model": service.llm.model_identifier, "configured": llm_configured,
                    "prompt_version": PROMPT_VERSION, "is_mock": settings.llm_provider == "mock"},
            "limits": service.limits.model_dump(),
            "telemetry": {"path": settings.telemetry_path, "stale_after_s": settings.telemetry_stale_after_s},
            "command_channel": settings.command_channel,
            "auth_mode": settings.auth_mode,
            "allow_safety_override": settings.allow_safety_override,
            "calibration_max_age_days": settings.calibration_max_age_days,
        }

    # ------------------------------------------------------- protected --
    @app.get("/api/objects", dependencies=guard)
    def objects():
        data = json.loads(PRESETS_FILE.read_text())
        return {"presets": data["presets"], "values_are_estimates": True}

    @app.post("/api/predict-grip", dependencies=guard)
    def predict_grip(req: PredictGripRequest, mode: Mode):
        return service.predict(mode, req)

    @app.get("/api/calibrations", dependencies=guard)
    def recent_calibrations(mode: Mode, limit: Annotated[int, Query(ge=1, le=200)] = 50):
        return {"records": service.recent_calibrations(mode, limit)}

    @app.get("/api/calibrations/{configuration_key}", dependencies=guard)
    def active_calibration(configuration_key: str, mode: Mode):
        return service.active_for_key(mode, _key(configuration_key))

    @app.post("/api/calibrations", dependencies=guard, status_code=201)
    def start_calibration(req: StartCalibrationRequest, mode: Mode):
        return service.start_calibration(mode, req)

    @app.post("/api/calibrations/{calibration_id}/tests", dependencies=guard)
    def calibration_test(calibration_id: str, req: TestEventRequest, mode: Mode):
        return service.record_test(mode, _cid(calibration_id), req)

    @app.post("/api/calibrations/{calibration_id}/confirm", dependencies=guard)
    def confirm_calibration(calibration_id: str, req: ConfirmRequest, mode: Mode):
        return service.confirm(mode, _cid(calibration_id), req)

    @app.post("/api/calibrations/{calibration_id}/invalidate", dependencies=guard)
    def invalidate_calibration(calibration_id: str, req: InvalidateRequest, mode: Mode):
        return service.invalidate(mode, _cid(calibration_id), req.reason)

    @app.get("/api/calibration-history/{configuration_key}", dependencies=guard)
    def calibration_history(configuration_key: str, mode: Mode):
        return service.history(mode, _key(configuration_key))

    @app.get("/api/telemetry/latest", dependencies=guard)
    def telemetry_latest():
        return service.telemetry_latest()

    @app.get("/api/operations", dependencies=guard)
    def operations(mode: Mode, limit: Annotated[int, Query(ge=1, le=200)] = 50):
        return {"operations": service.operations(mode, limit)}

    @app.post("/api/operations", dependencies=guard, status_code=201)
    def record_operation(req: OperationRequest, mode: Mode):
        return service.record_operation(mode, req)

    @app.post("/api/commands/force-target", dependencies=guard)
    def force_target(req: ForceCommandRequest, mode: Mode):
        return service.force_command(mode, req)

    _mount_frontend(app, settings.frontend_dist)
    return app


def _mount_frontend(app: FastAPI, dist: Optional[str]) -> None:
    """Serve the built SPA (with history-API fallback) after all /api routes are registered."""
    if not dist:
        return
    root = Path(dist).resolve()
    index = root / "index.html"
    if not index.is_file():
        raise RuntimeError(f"FRONTEND_DIST={dist!r} does not contain index.html (run `npm run build`).")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/") or path == "api":
            raise HTTPException(404, {"code": "not_found", "message": "No such API route."})
        target = (root / path).resolve()
        if path and root in target.parents and target.is_file():
            return FileResponse(target)
        return FileResponse(index)


def _cid(v: str) -> str:
    import re
    if not re.fullmatch(RECORD_ID_PATTERN, v):
        raise HTTPException(422, {"code": "bad_id", "message": "Malformed calibration id."})
    return v


def _key(v: str) -> str:
    import re
    if not re.fullmatch(KEY_PATTERN, v):
        raise HTTPException(422, {"code": "bad_key", "message": "Malformed configuration key."})
    return v


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
