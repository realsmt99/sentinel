"""Inventory scanner: docker ps by sentinel.* labels, docker inspect, live runtime version via docker exec."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from . import db
from .tools.docker_ops import docker, running_version
from .triage import runtime_name

_VERSION_ENV = {"php": "PHP_VERSION", "python": "PYTHON_VERSION"}


def _mode_from_image(image: str | None) -> str | None:
    tag = (image or "").rsplit(":", 1)[-1]
    if "apache" in tag:
        return "apache2handler"
    if "fpm" in tag:
        return "fpm-fcgi"
    return None


def _describe(info: dict[str, Any]) -> dict[str, Any]:
    config = info.get("Config") or {}
    labels = config.get("Labels") or {}
    language = (labels.get("sentinel.language") or "").strip().lower()
    container = info["Name"].lstrip("/")
    running = bool((info.get("State") or {}).get("Running"))
    env = dict(item.split("=", 1) for item in config.get("Env") or [] if "=" in item)
    version = running_version(container, language) if running else None
    version = version or env.get(_VERSION_ENV.get(language, ""))
    image = config.get("Image")
    mode = labels.get("sentinel.runtime_mode") or (_mode_from_image(image) if language == "php" else None)
    exposure = (labels.get("sentinel.exposure") or "internal").strip().lower()
    try:
        revenue = max(0, int(float(labels.get("sentinel.revenue") or 0)))
    except ValueError:
        revenue = 0
    return {
        "name": labels["sentinel.service"],
        "container_name": container,
        "language": language,
        "runtime_version": version,
        "runtime_mode": mode,
        "image": image,
        "exposure": exposure if exposure in {"public", "internal"} else "internal",
        "monthly_revenue_eur": revenue,
        "repo_path": labels.get("sentinel.repo_path"),
        "running": running,
    }


def discover() -> list[dict[str, Any]]:
    ids = docker("ps", "-a", "--filter", "label=sentinel.service", "--format", "{{.ID}}").split()
    if not ids:
        return []
    inspected = json.loads(docker("inspect", *ids))
    with ThreadPoolExecutor(max_workers=4) as pool:
        services = list(pool.map(_describe, inspected))
    return sorted(services, key=lambda s: (s["exposure"] != "public", s["runtime_mode"] is None, s["name"]))


def describe_service(service: dict[str, Any]) -> str:
    parts = [f"{runtime_name(service['language'])} {service.get('runtime_version') or '?'}"]
    if service.get("runtime_mode"):
        parts.append(service["runtime_mode"])
    parts.append(service["exposure"])
    if service.get("monthly_revenue_eur"):
        parts.append(f"{service['monthly_revenue_eur']:,} EUR/month")
    return f"{service['name']} ({', '.join(parts)})"


def scan(*, periodic: bool = False) -> list[dict[str, Any]]:
    """Upsert the discovered services (never touching status). periodic=True only refreshes an
    already connected inventory and logs only what changed."""
    before = {s["name"]: s for s in db.load_services()} if periodic else {}
    if periodic and not before:
        return []
    services = discover()
    rows = [{k: v for k, v in s.items() if k != "running"} for s in services]
    db.upsert_services(rows, only_if_connected=periodic)
    if not periodic:
        if services:
            db.log_line(
                f"Scanner: connected, {len(services)} services discovered: "
                + "; ".join(describe_service(s) for s in services),
                "success",
            )
        else:
            db.log_line("Scanner: no containers with sentinel.* labels found", "warn")
        return services
    for service in services:
        old = before.get(service["name"])
        if old is None:
            db.log_line(f"Scanner: new service {describe_service(service)}")
        elif (old["runtime_version"], old["image"]) != (service["runtime_version"] or old["runtime_version"], service["image"]):
            db.log_line(f"Scanner: {describe_service(service)} now runs {service['image']}")
    return services
