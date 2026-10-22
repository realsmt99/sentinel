"""compute_danger_score: the deterministic score, persisted to incidents. Used by the Risk Scoring agent's
tool and by the orchestrator's code fallback; the orchestrator only ever trusts the persisted number."""

from __future__ import annotations

import json
from typing import Any

from .. import db
from ..config import INTEL_FIXTURE
from ..scoring import AdvisoryFacts, ServiceFacts, advisory_facts, danger_score
from .nvd import component_ranges


def load_intel_fixture() -> dict[str, Any]:
    return json.loads(INTEL_FIXTURE.read_text())


def load_facts(component: str, intel: dict[str, Any] | None = None) -> AdvisoryFacts:
    if intel is None:
        row = db.latest_intel(component)
        intel = row["data"] if row else (load_intel_fixture() if component == "php" else {})
    cvss_values = [r["cvss"] for r in db.matched_cves(component) if r["cvss"] is not None]
    return advisory_facts(component, intel, component_ranges(component), max(cvss_values) if cvss_values else None)


def service_payload(row: dict[str, Any]) -> dict[str, Any]:
    keys = ("name", "container_name", "language", "runtime_version", "runtime_mode", "image", "exposure",
            "monthly_revenue_eur", "repo_path", "status")
    return {k: row.get(k) for k in keys}


def compute_and_persist(component: str, cve_ids: list[str], service_name: str, facts: AdvisoryFacts) -> dict[str, Any]:
    service = db.get_service(service_name)
    if not service:
        return {"error": f"unknown service {service_name!r}"}
    result = danger_score(ServiceFacts.from_row(service), facts)
    incident = db.upsert_incident_score(component, cve_ids, service["id"], result.score, result.breakdown, result.band)
    return {**result.to_dict(), "incident_id": incident["id"]}
