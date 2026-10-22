"""Entry point (`uv run sentinel`): FastAPI on AGENT_URL's port, the LISTEN loop and the orchestrator loop."""

from __future__ import annotations

import logging
import os
import socket

import uvicorn
from agents import set_tracing_disabled

from .api import create_app
from .config import get_settings
from .runtime import Runtime

log = logging.getLogger("sentinel")


def _sockets(port: int) -> list[socket.socket]:
    """Loopback on IPv4 and IPv6: 'localhost' may resolve to ::1 for the dashboard's server-side fetch."""
    host = os.getenv("SENTINEL_HOST")
    targets = [(socket.AF_INET6 if host and ":" in host else socket.AF_INET, host)] if host else [
        (socket.AF_INET, "127.0.0.1"),
        (socket.AF_INET6, "::1"),
    ]
    sockets = []
    for family, address in targets:
        sock = socket.socket(family, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if family == socket.AF_INET6:
            sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        try:
            sock.bind((address, port))
        except OSError as exc:
            sock.close()
            if family == socket.AF_INET6 and not host:
                log.warning("IPv6 loopback unavailable (%s)", exc)
                continue
            raise SystemExit(f"cannot bind {address}:{port}: {exc}") from exc
        sock.set_inheritable(True)
        sockets.append(sock)
    return sockets


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")
    for noisy in ("httpx", "httpcore", "openai", "openai.agents", "mcp", "github", "psycopg.pool"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    settings = get_settings()
    if not settings.openai_enabled:
        set_tracing_disabled(True)
    log.info("Guard API on %s", settings.agent_url)
    log.info("database: %s", "configured" if settings.database_url else "NOT SET (POST endpoints will fail)")
    log.info("agents:   %s", f"live ({settings.model_fast} / {settings.model_smart})" if settings.openai_enabled
             else "fallback (no OPENAI_API_KEY): every lane runs deterministic code")
    log.info("intel:    %s", "INTEL_OFFLINE=1, verified fixture" if settings.intel_offline else "cache, then live research")
    log.info("keenable: %s", "API key" if settings.keenable_api_key else "keyless public tier")
    log.info("github:   %s", settings.github_repo if settings.github_enabled else "not configured: PRs are skipped")
    log.info("ntfy:     %s", "topic set" if settings.ntfy_enabled else "NTFY_TOPIC not set: alerts are skipped")

    runtime = Runtime()
    runtime.start()
    server = uvicorn.Server(uvicorn.Config(create_app(runtime), log_level="warning", access_log=False))
    try:
        server.run(sockets=_sockets(settings.api_port))
    finally:
        runtime.stop()


if __name__ == "__main__":
    main()
