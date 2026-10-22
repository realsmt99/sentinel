"""Connect-your-project: the dashboard's Connect form reads the current connection, tests each field live
and applies new values (persisted to .env). Any project works if its containers carry sentinel.* labels."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse, urlunparse

import httpx
import psycopg

from .config import REPO_ROOT, get_settings, resolve_path, update_env
from .tools.docker_ops import DockerError, docker

MASK = "••••"
SERVICE_LABEL = "sentinel.service"
GUARD_TABLES = ("services", "cve_events", "threat_intel", "incidents", "agent_runs", "agent_log")

# Connect form field -> .env variable.
FIELDS = {
    "database_url": "DATABASE_URL",
    "github_repo": "GITHUB_REPO",
    "compose_file": "TARGET_COMPOSE_FILE",
    "target_url": "TARGET_URL",
    "ntfy_topic": "NTFY_TOPIC",
}


def mask_url(url: str | None) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    if not parsed.password:
        return url
    netloc = f"{parsed.username}:{MASK}@{parsed.hostname}" + (f":{parsed.port}" if parsed.port else "")
    return urlunparse(parsed._replace(netloc=netloc))


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def current() -> dict[str, Any]:
    """The connection the form is pre-filled with. The database password never leaves the backend."""
    s = get_settings()
    return {
        "database_url": mask_url(s.database_url),
        "github_repo": s.github_repo or "",
        "compose_file": _display_path(s.compose_file),
        "target_url": s.target_url,
        "ntfy_topic": s.ntfy_topic or "",
        "label": SERVICE_LABEL,
    }


def _database_url(value: str) -> str | None:
    value = value.strip()
    return get_settings().database_url if not value or MASK in value else value


def _test_database(value: str) -> tuple[bool, str]:
    url = _database_url(value)
    if not url:
        return False, "no database URI"
    with psycopg.connect(url, connect_timeout=6) as conn:
        version = conn.execute("show server_version").fetchone()[0]
        tables = conn.execute(
            "select count(*) from information_schema.tables where table_schema = 'public' and table_name = any(%s)",
            (list(GUARD_TABLES),),
        ).fetchone()[0]
    host = urlparse(url).hostname or "?"
    where = f"Aiven PostgreSQL {version}" if host.endswith("aivencloud.com") else f"PostgreSQL {version}"
    if tables < len(GUARD_TABLES):
        return False, f"{where} reachable, but the Guard schema is missing ({tables}/{len(GUARD_TABLES)} tables)"
    return True, f"{where} · {host.split('.')[0]} · Guard schema ready"


def _test_github(value: str) -> tuple[bool, str]:
    from github import Auth, Github

    name = value.strip()
    token = get_settings().github_token
    if not token:
        return False, "GITHUB_TOKEN is not set in .env"
    repo = Github(auth=Auth.Token(token), timeout=10).get_repo(name)
    can_push = bool(repo.permissions and repo.permissions.push)
    detail = f"{'private' if repo.private else 'public'} repo · default branch {repo.default_branch}"
    return can_push, detail + (" · can open pull requests" if can_push else " · read only: the token cannot open PRs")


def _test_docker(value: str) -> tuple[bool, str]:
    path = resolve_path(value.strip())
    if path is None or not path.is_file():
        return False, f"{value or 'compose file'} not found"
    in_project = set(docker("compose", "-f", str(path), "ps", "-a", "--format", "{{.Name}}", timeout=15).split())
    labeled = docker("ps", "-a", "--filter", f"label={SERVICE_LABEL}", "--format", "{{.Names}}", timeout=15).split()
    found = [name for name in labeled if name in in_project]
    if not found:
        return False, f"no running containers with {SERVICE_LABEL} labels in this project"
    return True, f"{len(found)} labeled services: {', '.join(sorted(found))}"


def _test_website(value: str) -> tuple[bool, str]:
    started = time.monotonic()
    status = httpx.get(value.strip(), timeout=5, follow_redirects=False).status_code
    ms = round((time.monotonic() - started) * 1000)
    return status < 500 or status == 503, f"HTTP {status} · {ms} ms"


def _test_ntfy(value: str) -> tuple[bool, str]:
    topic = value.strip()
    if not topic:
        return False, "no topic"
    response = httpx.post(
        f"{get_settings().ntfy_server.rstrip('/')}/{topic}",
        content="Guard is connected to your phone. Real alerts will look like this.".encode(),
        headers={"Title": "Guard: connection test", "Tags": "white_check_mark"},
        timeout=10,
    )
    return response.status_code < 300, f"test alert sent to {topic}" if response.status_code < 300 else f"ntfy answered HTTP {response.status_code}"


TESTS: dict[str, Callable[[str], tuple[bool, str]]] = {
    "database_url": _test_database,
    "github_repo": _test_github,
    "compose_file": _test_docker,
    "target_url": _test_website,
    "ntfy_topic": _test_ntfy,
}


def run_test(field: str, value: str) -> dict[str, Any]:
    if field not in TESTS:
        raise ValueError(f"unknown field {field!r}")
    try:
        passed, detail = TESTS[field](value)
    except DockerError as exc:
        passed, detail = False, f"Docker: {exc}"
    except Exception as exc:  # every failure is shown next to the field
        passed, detail = False, f"{type(exc).__name__}: {exc}"[:300]
    return {"field": field, "passed": passed, "detail": detail}


def apply(values: dict[str, str | None]) -> dict[str, Any]:
    """Save the fields that changed. A new database needs a restart: the pool and listener hold the old one."""
    s = get_settings()
    now = {
        "github_repo": s.github_repo or "",
        "compose_file": _display_path(s.compose_file),
        "target_url": s.target_url,
        "ntfy_topic": s.ntfy_topic or "",
    }
    changes: dict[str, str] = {}
    restart = False
    for field, env in FIELDS.items():
        value = (values.get(field) or "").strip()
        if not value:
            continue
        if field == "database_url":
            if MASK not in value and value != s.database_url:
                changes[env] = value
                restart = True
        elif value != now[field]:
            changes[env] = value
    if changes:
        update_env(changes)
    return {"changed": sorted(changes), "restart_required": restart}
