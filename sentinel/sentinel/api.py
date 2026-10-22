"""FastAPI surface for the dashboard. POSTs answer fast with {"ok": true, ...}; long work runs on the
runtime's worker thread. Errors answer {"ok": false, "error": "..."} with a 4xx/5xx status."""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import connection, db, feed, history, narrate, scanner
from .config import get_settings
from .reset import new_run, reset_demo
from .runtime import Runtime
from .tools import docker_ops

log = logging.getLogger("sentinel.api")

_SERVICE_KEYS = ("name", "language", "runtime_version", "runtime_mode", "image", "exposure", "monthly_revenue_eur",
                 "repo_path", "running")


class ConnectBody(BaseModel):
    """The dashboard's Connect form; empty or unchanged fields keep the current connection."""

    database_url: str | None = None
    github_repo: str | None = None
    compose_file: str | None = None
    target_url: str | None = None
    ntfy_topic: str | None = None


class FieldTestBody(BaseModel):
    field: str
    value: str = ""


class ApiError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


@lru_cache(maxsize=1)
def _feed_size() -> int:
    return len(feed.load_fixture())


_health_cache: dict[str, tuple[float, bool]] = {}


def _cached(key: str, ttl: float, check) -> bool:
    hit = _health_cache.get(key)
    if hit and time.monotonic() - hit[0] < ttl:
        return hit[1]
    try:
        value = bool(check())
    except Exception:
        value = False
    _health_cache[key] = (time.monotonic(), value)
    return value


def _keenable_reachable() -> bool:
    return httpx.get(get_settings().keenable_mcp_url, timeout=3).status_code < 500


def create_app(runtime: Runtime) -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Guard", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=sorted({settings.dashboard_url, "http://localhost:3000", "http://127.0.0.1:3000"}),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse({"ok": False, "error": exc.message}, status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"ok": False, "error": str(exc.detail)}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"ok": False, "error": f"invalid request: {exc.errors()[:1]}"}, status_code=422)

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled API error")
        return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, status_code=500)

    def require_db() -> None:
        if not settings.database_url:
            raise ApiError(503, "DATABASE_URL is not set")

    def refuse_while(*jobs: str) -> None:
        busy = [job for job in runtime.active() if job in jobs or any(job.startswith(j + ":") for j in jobs)]
        if busy:
            raise ApiError(409, f"busy: {busy[0]} is running")

    @app.get("/config")
    def config() -> dict[str, Any]:
        return {"ok": True, **connection.current()}

    @app.post("/config/test")
    def config_test(body: FieldTestBody) -> dict[str, Any]:
        if body.field not in connection.TESTS:
            raise ApiError(400, f"unknown field {body.field!r}")
        return {"ok": True, **connection.run_test(body.field, body.value)}

    @app.post("/connect")
    def connect(body: ConnectBody | None = None) -> dict[str, Any]:
        require_db()
        refuse_while("reset")
        applied = connection.apply(body.model_dump()) if body else {"changed": [], "restart_required": False}
        if applied["restart_required"]:
            raise ApiError(409, "the new database is saved in .env: restart Guard (backend and dashboard) to use it")
        if not history.current_run():
            history.start_run()
        narrate.user("Connect my project")
        try:
            with runtime.scan_lock:
                services = scanner.scan()
        except docker_ops.DockerError as exc:
            narrate.say(f"I could not reach Docker: {exc}")
            raise ApiError(503, f"Docker: {exc}") from exc
        if not services:
            narrate.say("I found no containers with Guard labels. Is the project running?")
            raise ApiError(404, "no containers with sentinel.* labels found: is the project running?")
        if applied["changed"]:
            db.log_line(f"Connect: project settings updated ({', '.join(applied['changed'])})", "success")
        narrate.connected(services)
        return {
            "ok": True,
            "count": len(services),
            "changed": applied["changed"],
            "services": [{k: s.get(k) for k in _SERVICE_KEYS} for s in services],
        }

    @app.post("/demo/replay")
    def replay() -> dict[str, Any]:
        require_db()
        refuse_while("replay", "advisory", "reset")
        if db.services_count() == 0:
            raise ApiError(409, "no system connected: POST /connect first")
        if db.cve_count() > 0:
            raise ApiError(409, "the feed was already replayed: POST /demo/reset first")
        narrate.user("Replay the NVD feed of 21 October 2026")
        runtime.submit("replay", runtime.replay_job)
        return {"ok": True, "started": "replay", "cves": _feed_size(), "chunk_size": settings.replay_chunk_size}

    @app.post("/restore/{service}")
    def restore(service: str) -> dict[str, Any]:
        require_db()
        refuse_while("reset", f"restore:{service}")
        if not db.get_service(service):
            raise ApiError(404, f"unknown service {service!r}")
        image = f"sentinel-{service}:patched"
        try:
            docker_ops.docker("image", "inspect", image, timeout=10)
        except docker_ops.DockerError as exc:
            raise ApiError(400, f"no patched image {image} for {service}") from exc
        queued_behind = runtime.current
        narrate.user(f"Approve the restore of {service}")
        runtime.submit(f"restore:{service}", lambda: docker_ops.restore(service))
        return {"ok": True, "started": "restore", "service": service, "image": image, "queued_behind": queued_behind}

    @app.post("/demo/new-run")
    def new_run_endpoint(wait: bool = False) -> dict[str, Any]:
        require_db()
        refuse_while("reset")
        if db.services_count() == 0:
            raise ApiError(409, "no system connected: connect a project first")
        queued_behind = runtime.current
        job = runtime.submit("reset", new_run)
        if wait:
            return {"ok": True, **job.wait(timeout=300)}
        return {"ok": True, "started": "new-run", "queued_behind": queued_behind}

    @app.post("/demo/reset")
    def reset(wait: bool = False, clear_intel: bool = False) -> dict[str, Any]:
        require_db()
        refuse_while("reset")
        queued_behind = runtime.current
        job = runtime.submit("reset", lambda: reset_demo(clear_intel=clear_intel))
        if wait:
            return {"ok": True, **job.wait(timeout=300)}
        return {"ok": True, "started": "reset", "clear_intel": clear_intel, "queued_behind": queued_behind}

    @app.get("/health")
    def health() -> dict[str, Any]:
        db_ok = bool(settings.database_url) and _cached("db", 5, lambda: db.ping(2.0))
        docker_ok = _cached("docker", 10, docker_ops.docker_available)
        connected = None
        if db_ok:
            try:
                connected = db.services_count() > 0
            except Exception:
                connected = None
        fresh = get_settings()
        return {
            "ok": db_ok and docker_ok,
            "db": db_ok,
            "openai": fresh.openai_enabled,
            "keenable": _cached("keenable", 60, _keenable_reachable),
            "github": fresh.github_enabled,
            "ntfy": fresh.ntfy_enabled,
            "docker": docker_ok,
            "mode": "live" if settings.openai_enabled else "fallback",
            "intel_offline": settings.intel_offline,
            "listener": runtime.listener_alive.is_set(),
            "connected": connected,
            "busy": runtime.current,
        }

    return app
