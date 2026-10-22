"""Actions on the plugged-in system: the gated take_offline, the human-approved restore, demo reset.
Everything goes through the docker CLI on the host and the nginx kill-switch flag files."""

from __future__ import annotations

import logging
import os
import subprocess
import time
from typing import Any

import httpx

from .. import db
from ..config import COMPOSE_FILE, FLAGS_DIR, REPO_ROOT, get_settings
from ..scoring import OFFLINE_THRESHOLD
from ..triage import runtime_name

log = logging.getLogger("sentinel.docker")

VERSION_COMMANDS = {
    "php": ["php", "-r", "echo PHP_VERSION;"],
    "python": ["python", "-c", "import platform; print(platform.python_version())"],
}
VULNERABLE_IMAGES = {"SHOP_IMAGE": "sentinel-shop:vulnerable", "ADMIN_PANEL_IMAGE": "sentinel-admin-panel:vulnerable"}


class DockerError(RuntimeError):
    pass


def docker(*args: str, timeout: float = 30, env: dict[str, str] | None = None) -> str:
    try:
        proc = subprocess.run(
            ["docker", *args], capture_output=True, text=True, timeout=timeout,
            env={**os.environ, **env} if env else None,
        )
    except FileNotFoundError as exc:
        raise DockerError("docker CLI not found on PATH") from exc
    except subprocess.TimeoutExpired as exc:
        raise DockerError(f"docker {' '.join(args[:2])} timed out after {timeout:.0f}s") from exc
    if proc.returncode != 0:
        raise DockerError((proc.stderr or proc.stdout).strip() or f"docker {args[0]} failed")
    return proc.stdout


def compose(*args: str, env: dict[str, str], timeout: float = 180) -> str:
    return docker("compose", "-f", str(COMPOSE_FILE), *args, timeout=timeout, env=env)


def docker_available() -> bool:
    try:
        docker("info", "--format", "{{.ServerVersion}}", timeout=5)
        return True
    except DockerError:
        return False


def flag_path(service: str):
    return FLAGS_DIR / f"{service}.flag"


def container_running(container: str) -> bool:
    try:
        return docker("inspect", "-f", "{{.State.Running}}", container, timeout=10).strip() == "true"
    except DockerError:
        return False


def running_version(container: str, language: str) -> str | None:
    command = VERSION_COMMANDS.get(language)
    if not command:
        return None
    try:
        return docker("exec", container, *command, timeout=15).strip() or None
    except DockerError:
        return None


def http_status(url: str, timeout: float = 4.0) -> int | None:
    try:
        return httpx.get(url, timeout=timeout, follow_redirects=False).status_code
    except httpx.HTTPError:
        return None


def wait_for(predicate, timeout: float, interval: float = 0.5) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


def take_offline(service_name: str, component: str) -> dict[str, Any]:
    """Kill switch for one service. Refuses unless the persisted danger score is >= 80."""
    service = db.get_service(service_name)
    if not service:
        return {"ok": False, "refused": True, "reason": f"unknown service {service_name!r}"}
    incident = db.get_incident(component, service_name)
    score = incident["danger_score"] if incident else None
    if score is None or score < OFFLINE_THRESHOLD:
        return {
            "ok": False,
            "refused": True,
            "service": service_name,
            "reason": f"refused: the persisted danger score for {service_name} is {score}, "
            f"take_offline needs >= {OFFLINE_THRESHOLD}",
        }

    FLAGS_DIR.mkdir(parents=True, exist_ok=True)
    flag = flag_path(service_name)
    flag.write_text(f"{component} {' '.join(incident['cve_ids'])} danger score {score}, set {db.now().isoformat()}\n")
    stop_error = None
    try:
        docker("stop", "-t", "3", service["container_name"], timeout=30)
    except DockerError as exc:
        stop_error = str(exc)
    stopped = not container_running(service["container_name"])

    db.update_service(service_name, status="OFFLINE")
    if incident["status"] == "OPEN":
        db.update_incident(incident["id"], status="MITIGATED", mitigated_at=db.now())
    result: dict[str, Any] = {
        "ok": True,
        "service": service_name,
        "score": score,
        "flag": str(flag.relative_to(REPO_ROOT)),
        "container_stopped": stopped,
    }
    if service["exposure"] == "public":
        result["edge_status"] = http_status(get_settings().target_url)
    if stop_error:
        result["stop_error"] = stop_error
    return result


def restore(service_name: str) -> dict[str, Any]:
    """Human-approved restore: recreate the service from its patched image, verify the runtime version,
    drop the kill switch, health-check, mark HEALTHY and resolve the incident."""
    from ..tools.risk import load_facts
    from ..scoring import assess_version

    service = db.get_service(service_name)
    if not service:
        raise ValueError(f"unknown service {service_name!r}")
    incident = db.latest_incident_for_service(service_name)
    image = f"sentinel-{service_name}:patched"
    env_var = service_name.upper().replace("-", "_") + "_IMAGE"
    try:
        docker("image", "inspect", image, timeout=10)
    except DockerError as exc:
        raise ValueError(f"no patched image {image} for {service_name}") from exc

    started = time.monotonic()
    previous_status = service["status"]
    db.update_service(service_name, status="RESTORING")
    db.log_line(f"Restore approved by a human: recreating {service_name} from {image}", component=incident and incident["component"])
    try:
        compose("up", "-d", "--no-build", service_name, env={**VULNERABLE_IMAGES, env_var: image})
        if not wait_for(lambda: container_running(service["container_name"]), timeout=30):
            raise DockerError(f"{service['container_name']} did not start")
        version = None
        for _ in range(10):
            version = running_version(service["container_name"], service["language"])
            if version:
                break
            time.sleep(1)
        if not version:
            raise DockerError(f"could not read the runtime version of {service_name}")
        if incident:
            verdict = assess_version(version, load_facts(incident["component"]))
            if verdict.affected:
                raise DockerError(f"{service_name} still runs an affected version ({version}): {verdict.reason}")

        flag_path(service_name).unlink(missing_ok=True)
        status_code = None
        if service["exposure"] == "public":
            url = get_settings().target_url
            ok = wait_for(lambda: http_status(url) == 200, timeout=30, interval=1.0)
            status_code = http_status(url)
            if not ok:
                raise DockerError(f"health check failed: GET {url} returned {status_code}")
    except Exception as exc:
        fallback_status = "OFFLINE" if flag_path(service_name).exists() or previous_status == "OFFLINE" else previous_status
        db.update_service(service_name, status=fallback_status)
        db.log_line(f"Restore of {service_name} failed: {exc}", "error", component=incident and incident["component"])
        raise

    db.update_service(service_name, status="HEALTHY", runtime_version=version, image=image)
    resolved = {}
    if incident and incident["status"] != "RESOLVED":
        resolved_at = db.now()
        db.update_incident(incident["id"], status="RESOLVED", resolved_at=resolved_at)
        resolved["time_to_resolve_s"] = round((resolved_at - incident["created_at"]).total_seconds())
    edge = f", {get_settings().target_url} -> {status_code}" if status_code else ""
    db.log_line(
        f"{service_name} restored on {runtime_name(service['language'])} {version}{edge}; "
        "kill switch removed, incident resolved",
        "success",
        component=incident and incident["component"],
    )
    return {"service": service_name, "version": version, "image": image, "http_status": status_code,
            "seconds": round(time.monotonic() - started, 1), **resolved}


def reset_target() -> dict[str, Any]:
    """Demo baseline: no kill-switch flags, shop back on the vulnerable image, every service up."""
    FLAGS_DIR.mkdir(parents=True, exist_ok=True)
    removed = []
    for flag in FLAGS_DIR.glob("*.flag"):
        flag.unlink(missing_ok=True)
        removed.append(flag.name)
    compose("up", "-d", "--no-build", env=VULNERABLE_IMAGES)
    shop_up = wait_for(lambda: container_running("shop"), timeout=30)
    version = running_version("shop", "php") if shop_up else None
    url = get_settings().target_url
    healthy = wait_for(lambda: http_status(url) == 200, timeout=30, interval=1.0)
    return {"flags_removed": removed, "shop_version": version, "edge_status": http_status(url), "edge_healthy": healthy}
