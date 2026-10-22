"""Settings from the repo-root .env. Variables already set in the shell win over .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
SENTINEL_DIR = REPO_ROOT / "sentinel"
FIXTURES_DIR = SENTINEL_DIR / "fixtures"
NVD_FIXTURE = FIXTURES_DIR / "nvd-2026-10-21.json"
INTEL_FIXTURE = FIXTURES_DIR / "php2shell-intel.json"
SCHEMA_SQL = SENTINEL_DIR / "db" / "schema.sql"
FLAGS_DIR = REPO_ROOT / "runtime" / "flags"
COMPOSE_FILE = REPO_ROOT / "target-system" / "docker-compose.yml"
ENV_FILE = REPO_ROOT / ".env"

# The project connection the dashboard's Connect form may change.
EDITABLE_ENV = {"DATABASE_URL", "GITHUB_REPO", "NTFY_TOPIC", "TARGET_URL", "TARGET_COMPOSE_FILE"}

load_dotenv(ENV_FILE, override=False)

# Values copied verbatim from .env.example count as unset.
_PLACEHOLDERS = {"sentinel-change-me", "your-user/sentinel"}


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, "").strip()
    if not value or value in _PLACEHOLDERS:
        return default
    return value


def _flag(name: str, default: bool = False) -> bool:
    value = _env(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str | None
    openai_api_key: str | None
    model_fast: str
    model_smart: str
    reasoning_effort: str | None
    keenable_api_key: str | None
    keenable_mcp_url: str
    keenable_api_url: str
    github_token: str | None
    github_repo: str | None
    ntfy_topic: str | None
    ntfy_server: str
    agent_url: str
    dashboard_url: str
    target_url: str
    compose_file: Path
    intel_offline: bool
    rescan_seconds: float
    replay_chunk_size: int
    replay_chunk_delay: float

    @property
    def openai_enabled(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def github_enabled(self) -> bool:
        return bool(self.github_token and self.github_repo)

    @property
    def ntfy_enabled(self) -> bool:
        return bool(self.ntfy_topic)

    @property
    def api_port(self) -> int:
        return urlparse(self.agent_url).port or 8000


def resolve_path(value: str | None) -> Path | None:
    """A path from .env or the Connect form: absolute, or relative to the repo root."""
    if not value:
        return None
    path = Path(value).expanduser()
    return path if path.is_absolute() else REPO_ROOT / path


def update_env(values: dict[str, str]) -> None:
    """Persist connection settings to .env and apply them to this process at once."""
    unknown = set(values) - EDITABLE_ENV
    if unknown:
        raise ValueError(f"not editable: {', '.join(sorted(unknown))}")
    lines = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    for key, value in values.items():
        entry = f"{key}={value}"
        index = next((i for i, line in enumerate(lines) if line.startswith(f"{key}=")), None)
        if index is None:
            lines.append(entry)
        else:
            lines[index] = entry
        os.environ[key] = value
    ENV_FILE.write_text("\n".join(lines) + "\n")
    get_settings.cache_clear()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings(
        database_url=_env("DATABASE_URL"),
        openai_api_key=_env("OPENAI_API_KEY"),
        model_fast=_env("OPENAI_MODEL_FAST", "gpt-5-mini"),
        model_smart=_env("OPENAI_MODEL_SMART", "gpt-5"),
        reasoning_effort=_env("OPENAI_REASONING_EFFORT"),
        keenable_api_key=_env("KEENABLE_API_KEY"),
        keenable_mcp_url=_env("KEENABLE_MCP_URL", "https://api.keenable.ai/mcp"),
        keenable_api_url=_env("KEENABLE_API_URL", "https://api.keenable.ai"),
        github_token=_env("GITHUB_TOKEN"),
        github_repo=_env("GITHUB_REPO"),
        ntfy_topic=_env("NTFY_TOPIC"),
        ntfy_server=_env("NTFY_SERVER", "https://ntfy.sh"),
        agent_url=_env("AGENT_URL", "http://localhost:8000"),
        dashboard_url=_env("DASHBOARD_URL", "http://localhost:3000"),
        target_url=_env("TARGET_URL", "http://localhost:8080"),
        compose_file=resolve_path(_env("TARGET_COMPOSE_FILE")) or COMPOSE_FILE,
        intel_offline=_flag("INTEL_OFFLINE"),
        rescan_seconds=float(_env("SENTINEL_RESCAN_SECONDS", "30")),
        replay_chunk_size=int(_env("SENTINEL_REPLAY_CHUNK", "25")),
        replay_chunk_delay=float(_env("SENTINEL_REPLAY_DELAY", "0.25")),
    )
