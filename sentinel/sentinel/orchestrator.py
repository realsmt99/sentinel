"""Orchestrator (plan section 2): plain Python drives the agent team for one advisory.

  Threat Intel -> Risk Scoring for every service in parallel -> Containment || Remediation

Order is enforced here, not by the models. Every agent step has a deterministic fallback (no OpenAI key,
agent error, timeout, skipped tool call) and the outcome is verified in code before the lane closes."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import Counter
from contextlib import nullcontext
from typing import Any

from agents import Runner, trace

from . import db
from .agents import containment as containment_agent
from .agents import intel as intel_agent
from .agents import remediation as remediation_agent
from .agents import scoring as scoring_agent
from .agents import triage as triage_agent
from .agents.common import AdvisoryContext
from .agents.models import ContainmentReport, RemediationResult, RiskAssessment
from .config import get_settings
from .hooks import DashboardHooks, lane_label
from .scoring import FIX_BANDS, PR_ONLY, TAKE_OFFLINE, ServiceFacts, danger_score
from .tools import docker_ops, notify, risk
from .tools.keenable import keenable_session
from .triage import CANDIDATE, DISMISSED, MATCHED, Inventory, classify, decide, rule_verdict, runtime_name

log = logging.getLogger("sentinel.orchestrator")

TIMEOUTS = {"triage": 150, "threat_intel": 240, "risk_scoring": 90, "containment": 90, "remediation": 240}
MAX_TURNS = {"triage": 3, "threat_intel": 16, "risk_scoring": 5, "containment": 6, "remediation": 14}


async def _db(fn, *args: Any, **kwargs: Any) -> Any:
    return await asyncio.to_thread(fn, *args, **kwargs)


async def _log(message: str, level: str = "info", **lane: Any) -> None:
    await _db(db.log_line, message, level, **lane)


def _error(exc: BaseException) -> str:
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timed out"
    return f"{type(exc).__name__}: {exc}"[:300]


async def _gather(*coros: Any) -> None:
    for result in await asyncio.gather(*coros, return_exceptions=True):
        if isinstance(result, BaseException):
            log.error("lane crashed", exc_info=result)
            await _log(f"Orchestrator: a lane crashed: {_error(result)}", "error")


async def run_agent(agent: Any, prompt: str, *, lane: tuple[str | None, str, str | None], context: Any = None) -> Any:
    component, name, service = lane
    result = await asyncio.wait_for(
        Runner.run(agent, prompt, context=context, hooks=DashboardHooks(component, name, service), max_turns=MAX_TURNS[name]),
        TIMEOUTS[name],
    )
    return result.final_output


# --- stage 1 (code), called from the LISTEN loop ------------------------------------------------


def _triage_rows(rows: list[dict]) -> Counter:
    inventory = Inventory.from_services(db.load_services())
    results = [classify(row, inventory) for row in rows if row["triage_status"] == "NEW"]
    db.update_triage(results)
    for result in results:
        if result["triage_status"] == MATCHED:
            db.log_line(f"Stage 1: {result['cve_id']} MATCHED: {result['triage_reason']}", "success",
                        component=result["component"])
    return Counter(r["triage_status"] for r in results)


def stage1_batch(min_id: int, max_id: int) -> Counter:
    """cve_batch handler: triage one replay chunk in code, one batch UPDATE."""
    return _triage_rows(db.cve_rows_between(min_id, max_id))


def catch_up_stage1() -> Counter:
    """Rows a missed notification left untriaged."""
    return _triage_rows(db.cve_rows_with_status("NEW"))


# --- feed_done: Triage agent on the candidates || one advisory per matched component -------------


async def handle_feed_done() -> None:
    await _db(catch_up_stage1)
    funnel = await _db(db.feed_funnel)
    await _log(
        f"Stage 1 (code): {funnel.get('total')} CVEs, {funnel.get('keyword_hits')} mention a runtime we run; "
        f"{funnel.get('matched')} MATCHED by CPE, {funnel.get('candidates')} keyword-only go to the Triage agent, "
        f"{funnel.get('dismissed')} DISMISSED. A keyword script would have paged us {funnel.get('keyword_hits')} times."
    )
    candidates = await _db(db.cve_rows_with_status, CANDIDATE)
    matched = await _db(db.matched_by_component)
    if not matched:
        await _log("Orchestrator: no CVE matches the inventory, nothing to act on")

    async def advisories() -> None:
        for component, cve_ids in matched.items():
            await handle_advisory(component, cve_ids)

    await _gather(run_triage(candidates), advisories())
    for component, cve_ids in (await _db(db.matched_by_component)).items():
        if set(cve_ids) - set(matched.get(component, [])):
            await _log(f"Orchestrator: triage escalated new {component} CVEs, re-running the advisory", "warn",
                       component=component)
            await handle_advisory(component, cve_ids)


async def run_triage(candidates: list[dict]) -> None:
    if not candidates:
        return
    lane = (None, "triage", None)
    services = await _db(db.load_services)
    inventory = Inventory.from_services(services)
    verdicts: dict[str, dict] | None = None
    status, error = "done", None
    await _db(db.lane_idle, *lane)
    if get_settings().openai_enabled:
        try:
            report = await run_agent(triage_agent.build_triage_agent(),
                                     triage_agent.triage_input(candidates, services, inventory), lane=lane)
            verdicts = {v.cve_id.strip().upper(): v.model_dump() for v in report.verdicts}
        except Exception as exc:
            status, error = "failed", _error(exc)
            await _log(f"Triage agent failed ({error}): the rule decides", "warn", agent="triage")
    else:
        status = "cached"
        await _db(db.lane_start, *lane)
        await _db(db.lane, *lane, last_tool="rule: description starts with 'PHP '")
        await _log("Triage: no OPENAI_API_KEY, rule fallback: a runtime CVE's description starts with "
                   "the runtime's own name ('PHP ')", "warn", agent="triage")

    updates, items, missing = [], [], 0
    for row in candidates:
        verdict = verdicts.get(row["cve_id"]) if verdicts is not None else None
        missing += verdicts is not None and verdict is None
        update, warning = decide(row, verdict, inventory)
        if warning:
            await _log(f"Triage: {warning}", "warn", agent="triage")
        updates.append(update)
        items.append({
            "cve_id": row["cve_id"],
            "status": update["triage_status"],
            "product": (verdict or rule_verdict(row, inventory))["product"],
            "reason": update["triage_reason"],
        })
    if missing:
        await _log(f"Triage: the agent skipped {missing} CVEs, the rule decided those", "warn", agent="triage")
    await _db(db.update_triage, updates)

    dismissed = sum(i["status"] == DISMISSED for i in items)
    escalated = sum(i["status"] == MATCHED for i in items)
    output = {"mode": "agent" if verdicts is not None else "rule", "candidates": len(items),
              "dismissed": dismissed, "escalated": escalated, "verdicts": items}
    await _db(db.lane_finish, *lane, status=status, output=output, error=error)
    top = ", ".join(f"{p} ({n})" for p, n in Counter(i["product"] for i in items if i["status"] == DISMISSED).most_common(3))
    await _log(f"Triage: {dismissed} of {len(items)} keyword-only CVEs dismissed as application-level flaws "
               f"(e.g. {top}); {escalated} escalated", "success", agent="triage")


# --- one advisory --------------------------------------------------------------------------------


async def handle_advisory(component: str, cve_ids: list[str]) -> None:
    started = time.monotonic()
    live = get_settings().openai_enabled
    run = AdvisoryContext(component=component, cve_ids=cve_ids)
    services = await _db(db.load_services)
    await _db(db.lane_idle, component, "threat_intel", None)
    for service in services:
        await _db(db.lane_idle, component, "risk_scoring", service["name"])
    await _log(f"Orchestrator: {', '.join(cve_ids)} matched the {runtime_name(component)} runtime, starting the agent team"
               + ("" if live else " (fallback mode: no OPENAI_API_KEY, every lane runs deterministic code)"),
               component=component)

    async with (keenable_session() if live else nullcontext()) as keenable:
        with trace(f"Sentinel {component} {' '.join(cve_ids)}", metadata={"component": component}):
            run.intel = await run_intel(run, keenable)
            run.facts = await _db(risk.load_facts, component, run.intel)
            run.slug = remediation_agent.advisory_slug(run.intel, component, cve_ids)

            services = await _db(db.load_services)
            await _gather(*(run_scoring(run, s) for s in services))

            incidents = {i["service"]: i for i in await _db(db.incidents_for, component)}
            offline = [s for s in services if (incidents.get(s["name"]) or {}).get("band") == TAKE_OFFLINE]
            fixes = [s for s in services if (incidents.get(s["name"]) or {}).get("band") in FIX_BANDS]
            for service in offline:
                await _db(db.lane_idle, component, "containment", service["name"])
            for service in fixes:
                await _db(db.lane_idle, component, "remediation", service["name"])
            await _gather(*(run_containment(run, s) for s in offline), *(run_remediation(run, s, keenable) for s in fixes))
            await verify_postconditions(run, offline, fixes)
    await log_summary(run, started)


async def run_intel(run: AdvisoryContext, keenable: Any) -> dict[str, Any]:
    lane = (run.component, "threat_intel", None)
    lane_kw = {"component": run.component, "agent": "threat_intel"}
    settings = get_settings()
    fixture = risk.load_intel_fixture() if run.component == "php" else None
    live = settings.openai_enabled and not settings.intel_offline
    cached = await _db(db.latest_intel, run.component)

    if cached and not (live and cached["data"] == fixture):
        await _db(db.lane_start, *lane)
        what = "the verified fixture" if cached["data"] == fixture else "research"
        await _db(db.lane, *lane, last_tool=f"threat_intel cache #{cached['id']}")
        await _log(f"Threat Intel: reusing {what} cached at {cached['fetched_at']:%H:%M:%S} (threat_intel #{cached['id']})", **lane_kw)
        await _db(db.lane_finish, *lane, status="cached", output=cached["data"])
        await _log_intel(cached["data"], lane_kw)
        return cached["data"]

    error = None
    if live:
        try:
            cves = await _db(db.matched_cves, run.component)
            report = await run_agent(intel_agent.build_intel_agent(keenable),
                                     intel_agent.intel_input(run.component, run.cve_ids, cves), lane=lane, context=run)
            problems = intel_agent.validate_intel(report)
            if problems:
                raise ValueError("research incomplete: " + "; ".join(problems))
            data = report.data()
            await _db(db.save_intel, run.component, run.cve_ids, data)
            await _db(db.lane_finish, *lane, status="done", output=data)
            await _log_intel(data, lane_kw)
            return data
        except Exception as exc:
            if fixture is None:
                raise
            error = _error(exc)
            await _log(f"Threat Intel agent failed ({error}): using the verified fixture", "warn", **lane_kw)
            status = "failed"
    else:
        if fixture is None:
            raise RuntimeError(f"no threat intel available for {run.component}")
        reason = "INTEL_OFFLINE=1" if settings.intel_offline else "no OPENAI_API_KEY"
        await _db(db.lane_start, *lane)
        await _db(db.lane, *lane, last_tool="fixtures/php2shell-intel.json")
        await _log(f"Threat Intel: {reason}, loading the verified fixture fixtures/php2shell-intel.json", "warn", **lane_kw)
        status = "cached"
    if not cached:
        await _db(db.save_intel, run.component, run.cve_ids, fixture)
    await _db(db.lane_finish, *lane, status=status, output=fixture, error=error)
    await _log_intel(fixture, lane_kw)
    return fixture


async def _log_intel(data: dict[str, Any], lane_kw: dict[str, Any]) -> None:
    fixes = data.get("fixed_versions") or {}
    fixed = ", ".join(e.get("version", "") for e in fixes.values()) if isinstance(fixes, dict) else ""
    await _log(
        f"Threat Intel: CVSS {data.get('cvss')} (v{data.get('cvss_version')}), exploitation reported: "
        f"{'yes' if data.get('exploitation_reported') else 'no'}, high-risk modes: "
        f"{', '.join(data.get('high_risk_runtime_modes') or []) or 'none'}, fixed in {fixed or 'unknown'}, "
        f"{len(data.get('sources') or [])} sources, {len(data.get('conflicts') or [])} conflict(s)",
        "success", **lane_kw,
    )


async def run_scoring(run: AdvisoryContext, service: dict[str, Any]) -> None:
    name = service["name"]
    lane = (run.component, "risk_scoring", name)
    lane_kw = {"component": run.component, "agent": "risk_scoring", "service": name}
    label = lane_label("risk_scoring", name)
    assessment: RiskAssessment | None = None
    status, error = "done", None
    if get_settings().openai_enabled:
        try:
            assessment = await run_agent(scoring_agent.build_scoring_agent(), scoring_agent.scoring_input(run, service),
                                         lane=lane, context=run.for_service(name))
        except Exception as exc:
            status, error = "failed", _error(exc)
            await _log(f"{label}: agent failed ({error}), scoring in code", "warn", **lane_kw)
    else:
        status = "cached"
        await _db(db.lane_start, *lane)

    computed = danger_score(ServiceFacts.from_row(service), run.facts).to_dict()
    incident = await _db(db.get_incident, run.component, name)
    if incident is None or incident["danger_score"] is None:
        if status == "done":
            status, error = "failed", "postcondition: the agent did not call compute_danger_score; scored in code"
            await _log(f"{label}: {error}", "warn", **lane_kw)
        call = f"compute_danger_score({name})"
        await _db(db.lane, *lane, last_tool=call)
        await _log(f"{label} -> {call} (code)", **lane_kw)
        await _db(risk.compute_and_persist, run.component, run.cve_ids, name, run.facts)
        incident = await _db(db.get_incident, run.component, name)

    agrees = assessment is not None and (assessment.score, assessment.band) == (incident["danger_score"], incident["band"])
    if assessment is not None and not agrees:
        await _log(f"{label}: the agent reported {assessment.score} {assessment.band}; Sentinel keeps the computed "
                   f"{incident['danger_score']} {incident['band']}", "warn", **lane_kw)
    explanation = assessment.explanation if agrees else scoring_agent.explain(service, incident, computed)
    await _db(db.update_incident, incident["id"], explanation=explanation)
    output = RiskAssessment(service=name, score=incident["danger_score"], band=incident["band"],
                            explanation=explanation).model_dump()
    output["breakdown"] = incident["score_breakdown"]
    await _db(db.lane_finish, *lane, status=status, output=output, error=error)
    await _log(f"{label}: {incident['danger_score']} {incident['band']}: {explanation}",
               "success" if incident["band"] != TAKE_OFFLINE else "warn", **lane_kw)


def _is_offline(service: dict[str, Any]) -> bool:
    row = db.get_service(service["name"]) or {}
    return (docker_ops.flag_path(service["name"]).exists()
            and not docker_ops.container_running(service["container_name"])
            and row.get("status") == "OFFLINE")


async def run_containment(run: AdvisoryContext, service: dict[str, Any]) -> None:
    name = service["name"]
    lane = (run.component, "containment", name)
    lane_kw = {"component": run.component, "agent": "containment", "service": name}
    label = lane_label("containment", name)
    settings = get_settings()
    ctx = run.for_service(name)
    incident = await _db(db.get_incident, run.component, name)
    report: ContainmentReport | None = None
    status, error = "done", None
    if settings.openai_enabled:
        try:
            report = await run_agent(containment_agent.build_containment_agent(),
                                     containment_agent.containment_input(run, service, incident), lane=lane, context=ctx)
        except Exception as exc:
            status, error = "failed", _error(exc)
            await _log(f"{label}: agent failed ({error}), containing in code", "warn", **lane_kw)
    else:
        status = "cached"
        await _db(db.lane_start, *lane)

    if not await _db(_is_offline, service):
        if status == "done":
            status, error = "failed", "postcondition: service still reachable after the agent; take_offline called by code"
            await _log(f"{label}: {error}", "warn", **lane_kw)
        call = f"take_offline({name})"
        await _db(db.lane, *lane, last_tool=call)
        await _log(f"{label} -> {call} (code)", **lane_kw)
        result = await _db(docker_ops.take_offline, name, run.component)
        if result.get("refused"):
            await _log(f"{label} <- take_offline: {result['reason']}", "warn", **lane_kw)
    offline = await _db(_is_offline, service)

    if not ctx.alerts:
        title, message = containment_agent.alert_text(run, service, incident)
        call = f'send_alert("{title}")'
        await _db(db.lane, *lane, last_tool=call)
        await _log(f"{label} -> {call} (code)", **lane_kw)
        ctx.alerts.append(await _db(notify.send_alert, title, message, "urgent", settings.dashboard_url,
                                    containment_agent.alert_tags("urgent")))
    alert_sent = any(a.get("sent") for a in ctx.alerts)
    if not alert_sent:
        reason = next((a.get("reason") or a.get("error") for a in ctx.alerts if not a.get("sent")), "not sent")
        await _log(f"{label}: phone alert {reason}", "warn", **lane_kw)

    message = report.message if report else (
        f"{name} is offline behind the maintenance page; "
        + ("urgent alert sent. " if alert_sent else "alert skipped. ")
        + "Next: review the fix PR, then approve the restore."
    )
    output = ContainmentReport(service=name, offline=offline, alert_sent=alert_sent, message=message).model_dump()
    output["edge_status"] = await _db(docker_ops.http_status, settings.target_url) if service["exposure"] == "public" else None
    if not offline:
        status, error = "failed", error or "service is still reachable"
    await _db(db.lane_finish, *lane, status=status, output=output, error=error)
    edge = f", {settings.target_url} returns {output['edge_status']}" if output["edge_status"] else ""
    await _log(f"{label}: {name} is {'offline' if offline else 'STILL ONLINE'} (maintenance page, container stopped{edge})",
               "success" if offline else "error", **lane_kw)


async def run_remediation(run: AdvisoryContext, service: dict[str, Any], keenable: Any) -> None:
    name = service["name"]
    lane = (run.component, "remediation", name)
    lane_kw = {"component": run.component, "agent": "remediation", "service": name}
    label = lane_label("remediation", name)
    settings = get_settings()
    ctx = run.for_service(name)
    incident = await _db(db.get_incident, run.component, name)
    result: RemediationResult | None = None
    status, error = "done", None
    if settings.openai_enabled:
        try:
            result = await run_agent(remediation_agent.build_remediation_agent(keenable),
                                     remediation_agent.remediation_input(run, service, incident), lane=lane, context=ctx)
        except Exception as exc:
            status, error = "failed", _error(exc)
            await _log(f"{label}: agent failed ({error}), building the fix in code", "warn", **lane_kw)
    else:
        status = "cached"
        await _db(db.lane_start, *lane)
        await _log(f"{label}: no OPENAI_API_KEY, building the fix in code", "warn", **lane_kw)

    if result is None or not any(r.get("pr_url") or r.get("skipped") for r in ctx.pr_results):
        if status == "done":
            status, error = "failed", "postcondition: no fix PR from the agent; built in code"
            await _log(f"{label}: {error}", "warn", **lane_kw)
        await _db(db.lane, *lane, last_tool=f"open_fix_pr({name}) (code)")
        result = await remediation_agent.remediate_in_code(ctx, service, incident)

    pr_url = next((r["pr_url"] for r in ctx.pr_results if r.get("pr_url")), None) or result.pr_url
    skipped = next((r.get("reason") for r in ctx.pr_results if r.get("skipped")), None)
    title = next((r.get("title") for r in ctx.pr_results if r.get("title")), "")
    remediation = result.model_copy(update={"pr_url": pr_url}).model_dump()
    remediation.update({
        "branch": f"sentinel/{run.slug}-{name}",
        "breaking_change": title.startswith("[breaking change"),
        "pr_skipped_reason": skipped,
        "docker_tags_checked": [t.get("image") for t in ctx.tag_checks if t.get("exists")],
    })
    await _db(db.update_incident, incident["id"], remediation=remediation, pr_url=pr_url)
    current = await _db(db.get_service, name)
    if incident["band"] != TAKE_OFFLINE and current and current["status"] == "HEALTHY" and result.target_version:
        await _db(db.update_service, name, status="PATCH_PENDING")

    if incident["band"] == PR_ONLY:
        alert_title = f"Sentinel: fix PR for {name} ({run.short_name})"
        alert_message = (
            f"Danger score {incident['danger_score']}/100 ({incident['band']}): {name} keeps running.\n"
            f"Fix: PHP {result.target_version or '?'}" + (f", PR {pr_url}" if pr_url else f" ({skipped or 'PR not opened'})")
        )
        await _db(db.lane, *lane, last_tool=f'send_alert("{alert_title}")')
        await _log(f'{label} -> send_alert("{alert_title}") (code)', **lane_kw)
        sent = await _db(notify.send_alert, alert_title, alert_message, "default", pr_url or settings.dashboard_url, ["wrench"])
        if not sent.get("sent"):
            await _log(f"{label}: phone alert {sent.get('reason') or sent.get('error')}", "warn", **lane_kw)

    await _db(db.lane_finish, *lane, status=status, output=remediation, error=error)
    outcome = f"PR {pr_url}" if pr_url else f"PR not opened ({skipped or result.notes})"
    verified = "Docker tag verified" if result.docker_tag_verified else "Docker tag NOT verified"
    await _log(f"{label}: PHP {result.target_version or '?'} ({verified}), {', '.join(result.files_changed) or 'no files'}: {outcome}",
               "success" if pr_url or skipped else "warn", **lane_kw)


async def verify_postconditions(run: AdvisoryContext, offline: list[dict], fixes: list[dict]) -> None:
    problems = []
    for service in offline:
        if not await _db(_is_offline, service):
            result = await _db(docker_ops.take_offline, service["name"], run.component)
            problems.append(f"{service['name']} was still reachable, take_offline re-run: {result.get('ok')}")
    for service in fixes:
        incident = await _db(db.get_incident, run.component, service["name"])
        if not (incident and incident.get("remediation")):
            problems.append(f"{service['name']}: no remediation recorded")
    if problems:
        await _log("Orchestrator: postconditions: " + "; ".join(problems), "warn", component=run.component)
    else:
        offline_names = ", ".join(s["name"] for s in offline) or "none"
        await _log(f"Orchestrator: postconditions verified (offline: {offline_names}; fixes recorded for "
                   f"{', '.join(s['name'] for s in fixes) or 'none'})", component=run.component)


async def log_summary(run: AdvisoryContext, started: float) -> None:
    parts = []
    for incident in await _db(db.incidents_for, run.component):
        notes = []
        if incident["status"] == "MITIGATED":
            notes.append("offline")
        if incident.get("pr_url"):
            notes.append("PR open")
        parts.append(f"{incident['service']} {incident['danger_score']} {incident['band']}"
                     + (f" ({', '.join(notes)})" if notes else ""))
    await _log(f"Sentinel: {run.short_name} handled in {time.monotonic() - started:.0f}s: " + "; ".join(parts),
               "success", component=run.component)
