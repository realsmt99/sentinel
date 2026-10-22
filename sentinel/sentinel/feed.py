"""Replay the NVD 2026-10-21 fixture into cve_events, in chunks (one INSERT, one cve_batch NOTIFY each)."""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import db
from .config import NVD_FIXTURE, get_settings

_CVSS_KEYS = (("cvssMetricV40", "4.0"), ("cvssMetricV31", "3.1"), ("cvssMetricV30", "3.0"), ("cvssMetricV2", "2.0"))


def pick_cvss(metrics: dict[str, Any]) -> tuple[float | None, str | None]:
    """Newest CVSS version wins (v4.0 > v3.1 > v3.0 > v2); within it the Primary entry, else the first."""
    for key, version in _CVSS_KEYS:
        entries = metrics.get(key) or []
        if not entries:
            continue
        entry = next((e for e in entries if e.get("type") == "Primary"), entries[0])
        data = entry.get("cvssData", {})
        if data.get("baseScore") is not None:
            return float(data["baseScore"]), data.get("version") or version
    return None, None


def parse_published(value: str) -> str:
    """NVD timestamps carry no offset and are UTC."""
    published = datetime.fromisoformat(value)
    if published.tzinfo is None:
        published = published.replace(tzinfo=UTC)
    return published.isoformat()


def parse_cve(item: dict[str, Any]) -> dict[str, Any]:
    cve = item["cve"]
    cvss, cvss_version = pick_cvss(cve.get("metrics", {}))
    return {
        "cve_id": cve["id"],
        "published": parse_published(cve["published"]),
        "description": next((d["value"] for d in cve.get("descriptions", []) if d.get("lang") == "en"), ""),
        "cvss": cvss,
        "cvss_version": cvss_version,
        "cpes": cve.get("configurations") or [],
    }


def load_fixture(path: Path = NVD_FIXTURE) -> list[dict[str, Any]]:
    data = json.loads(path.read_text())
    return [parse_cve(item) for item in data["vulnerabilities"]]


def replay(after_chunk: Callable[[], None] | None = None) -> dict[str, int]:
    """Insert the fixture chunk by chunk, committing each chunk, then NOTIFY feed_done."""
    settings = get_settings()
    rows = load_fixture()
    size = max(1, settings.replay_chunk_size)
    db.log_line(f"Feed: replaying the NVD feed of 21 Oct 2026, {len(rows)} CVEs in chunks of {size}")
    inserted = 0
    for start in range(0, len(rows), size):
        with db.connection() as conn:
            inserted += db.insert_cve_chunk(conn, rows[start : start + size])
        if after_chunk:
            after_chunk()
        time.sleep(settings.replay_chunk_delay)
    db.notify("feed_done", "")
    db.log_line(f"Feed: {inserted} CVEs received from NVD")
    return {"total": len(rows), "inserted": inserted}
