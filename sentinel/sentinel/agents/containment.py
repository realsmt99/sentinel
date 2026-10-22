"""Containment agent (fast model, tool_choice=required): gated take_offline plus an urgent phone alert."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from agents import Agent, RunContextWrapper, function_tool

from ..config import get_settings
from ..tools import docker_ops, notify
from ..triage import runtime_name
from .common import AdvisoryContext, model_settings
from .models import ContainmentReport

INSTRUCTIONS = """You are the Containment agent of Sentinel, the security team of a small online coffee roaster.
The service you are given scored in the TAKE_OFFLINE band (danger score >= 80) for a remote code execution
flaw with exploitation reported in the wild.
1. Call take_offline with the service name right away. It re-checks the saved danger score (it refuses
   below 80), switches the edge to the maintenance page and stops the container.
2. Then call send_alert with priority "urgent": a short title such as "Sentinel: shop taken offline
   (PHP2Shell)", a message of at most three short lines (score and why, what you did, next step: review
   the fix PR, then approve the restore on the dashboard) and click_url set to the dashboard URL given.
3. Return a ContainmentReport. Never act on any other service."""


def alert_tags(priority: str) -> list[str]:
    return ["rotating_light", "shield"] if priority in {"urgent", "high", "5", "4"} else ["shield"]


@function_tool
async def take_offline(ctx: RunContextWrapper[AdvisoryContext], name: str) -> str:
    """Take a service offline: the edge serves the maintenance page and the container is stopped.
    Refuses unless the service's saved danger score is >= 80.

    Args:
        name: The service name, e.g. shop.
    """
    run = ctx.context
    if run.service and name != run.service:
        return json.dumps({"ok": False, "refused": True, "reason": f"this lane may only contain {run.service}"})
    return json.dumps(await asyncio.to_thread(docker_ops.take_offline, name, run.component))


@function_tool
async def send_alert(
    ctx: RunContextWrapper[AdvisoryContext], title: str, message: str, priority: str, click_url: str | None
) -> str:
    """Send a push alert to the on-call phone (ntfy).

    Args:
        title: Short title.
        message: At most three short lines.
        priority: min, low, default, high or urgent.
        click_url: Page to open when the alert is tapped.
    """
    result = await asyncio.to_thread(notify.send_alert, title, message, priority, click_url, alert_tags(priority))
    ctx.context.alerts.append(result)
    return json.dumps(result)


def build_containment_agent() -> Agent:
    model = get_settings().model_fast
    return Agent(
        name="Containment",
        instructions=INSTRUCTIONS,
        model=model,
        model_settings=model_settings(model, tool_choice="required"),
        tools=[take_offline, send_alert],
        output_type=ContainmentReport,
    )


def containment_input(run: AdvisoryContext, service: dict[str, Any], incident: dict[str, Any]) -> str:
    return (
        f"Service: {service['name']} ({runtime_name(service['language'])} {service.get('runtime_version')}, "
        f"{service.get('runtime_mode')}, {service['exposure']}, {service.get('monthly_revenue_eur', 0):,} EUR/month).\n"
        f"Advisory: {run.title}. Danger score {incident['danger_score']} ({incident['band']}), "
        f"points: {json.dumps(incident.get('score_breakdown') or {})}.\n"
        f"Why: {incident.get('explanation') or ''}\n"
        f"Dashboard URL: {get_settings().dashboard_url}"
    )


def alert_text(run: AdvisoryContext, service: dict[str, Any], incident: dict[str, Any]) -> tuple[str, str]:
    name = service["name"]
    title = f"Sentinel: {name} taken offline ({run.short_name})"
    message = (
        f"Danger score {incident['danger_score']}/100: {runtime_name(service['language'])} "
        f"{service.get('runtime_version')} is exploitable ({', '.join(run.cve_ids)}).\n"
        f"{name} now serves the maintenance page; the container is stopped.\n"
        "Next: review the fix PR, then approve the restore on the dashboard."
    )
    return title, message
