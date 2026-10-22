"""Risk Scoring agent (fast model, one run per service): calls the deterministic score tool and explains it."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from agents import Agent, RunContextWrapper, function_tool

from .. import db
from ..config import get_settings
from ..scoring import DIGEST, NONE, PR_ONLY, TAKE_OFFLINE
from ..tools import risk
from ..triage import runtime_name
from .common import AdvisoryContext, model_settings
from .models import RiskAssessment

INSTRUCTIONS = """You are a Risk Scoring agent of Sentinel, the security team of a small online coffee roaster.
You assess one service for one advisory.
1. Call compute_danger_score with the service name. It runs Sentinel's deterministic formula, saves the
   result and returns the score, the band and the points per factor. Never compute or adjust the score.
2. Return a RiskAssessment with exactly the returned score and band and a two-sentence explanation for
   the business owner: what is at stake for this service (exposure, revenue, runtime mode, fix
   availability) and what the band means. Bands: TAKE_OFFLINE = taken offline now; PR_ONLY = keeps running,
   fix PR and an alert; DIGEST = fix PR, no alert; NONE = not affected, no action."""


@function_tool
async def compute_danger_score(ctx: RunContextWrapper[AdvisoryContext], name: str) -> str:
    """Compute and save Sentinel's deterministic danger score (0-100) of one service for the current
    advisory. Returns the score, band, points per factor and the version verdict.

    Args:
        name: The service name, e.g. shop.
    """
    run = ctx.context
    if run.service and name != run.service:
        return json.dumps({"error": f"this lane scores {run.service} only"})
    result = await asyncio.to_thread(risk.compute_and_persist, run.component, run.cve_ids, name, run.facts)
    return json.dumps(result)


@function_tool
async def get_service(name: str) -> str:
    """Inventory facts of one service: runtime, version, runtime mode, exposure, monthly revenue, status.

    Args:
        name: The service name, e.g. shop.
    """
    row = await asyncio.to_thread(db.get_service, name)
    return json.dumps(risk.service_payload(row) if row else {"error": f"unknown service {name!r}"})


def build_scoring_agent() -> Agent:
    model = get_settings().model_fast
    return Agent(
        name="Risk Scoring",
        instructions=INSTRUCTIONS,
        model=model,
        model_settings=model_settings(model, tool_choice="required"),
        tools=[compute_danger_score, get_service],
        output_type=RiskAssessment,
    )


def scoring_input(run: AdvisoryContext, service: dict[str, Any]) -> str:
    return (
        f"Service: {service['name']}. Advisory: {run.title}.\n"
        f"Threat Intel summary: {run.intel.get('summary', '')}\n"
        f"Exploitation: {run.intel.get('exploitation_evidence', 'unknown')}"
    )


def explain(service: dict[str, Any], incident: dict[str, Any], result: dict[str, Any] | None = None) -> str:
    """Template explanation used when the agent is not available."""
    name = service["name"]
    score, band = incident["danger_score"], incident["band"]
    runtime = f"{runtime_name(service['language'])} {service.get('runtime_version') or ''}".strip()
    fixed = (result or {}).get("fixed_version")
    if band == NONE:
        reason = (result or {}).get("reason") or "not in an affected version range"
        return f"{name} runs {runtime}; {reason}. Not affected, no action needed."
    breakdown = incident.get("score_breakdown") or {}
    exposure = "public-facing" if breakdown.get("exposure") == 20 else "internal"
    revenue = service.get("monthly_revenue_eur") or 0
    stake = f"{name} is {exposure}" + (f", earns {revenue:,} EUR/month" if revenue else "")
    mode = service.get("runtime_mode")
    mode_note = f" and runs {runtime} under {mode}" + (", the highest-risk runtime mode" if breakdown.get("runtime_mode") == 10 else "")
    no_fix = " Its branch has no official fix." if breakdown.get("no_official_fix") else ""
    target = f" to {fixed}" if fixed else ""
    action = {
        TAKE_OFFLINE: f"Sentinel takes it offline now and opens a fix PR{target}.",
        PR_ONLY: f"It keeps running; Sentinel opens a fix PR{target} and alerts the team.",
        DIGEST: f"It keeps running; a fix PR{target} goes into the digest without an alert.",
    }[band]
    return f"{stake}{mode_note if mode else ''}, so the advisory scores {score}/100 ({band}).{no_fix} {action}"
