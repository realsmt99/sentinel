"""Phone alerts through ntfy.sh (POST https://ntfy.sh/<topic> with Title/Priority/Tags/Click headers)."""

from __future__ import annotations

import unicodedata
from typing import Any

import httpx

from ..config import get_settings

PRIORITIES = {"min": 1, "low": 2, "default": 3, "high": 4, "urgent": 5, "max": 5}


def _header(value: str) -> str:
    text = value.replace("\u2014", "-").replace("\u2013", "-").replace("\u2192", "->")
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().strip()[:250]


def send_alert(
    title: str,
    message: str,
    priority: str = "default",
    click_url: str | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.ntfy_topic:
        return {"sent": False, "skipped": True, "reason": "skipped: NTFY_TOPIC not set"}
    level = PRIORITIES.get(str(priority).lower(), 3) if not str(priority).isdigit() else min(5, max(1, int(priority)))
    headers = {"Title": _header(title), "Priority": str(level)}
    if tags:
        headers["Tags"] = _header(",".join(tags))
    if click_url:
        headers["Click"] = _header(click_url)
    try:
        response = httpx.post(
            f"{settings.ntfy_server.rstrip('/')}/{settings.ntfy_topic}",
            content=message.encode("utf-8"),
            headers=headers,
            timeout=10,
        )
    except httpx.HTTPError as exc:
        return {"sent": False, "error": f"ntfy unreachable: {exc}"}
    if response.status_code >= 300:
        return {"sent": False, "error": f"ntfy returned HTTP {response.status_code}"}
    return {"sent": True, "priority": level, "title": title}
