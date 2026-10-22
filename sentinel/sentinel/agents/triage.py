"""Triage agent (fast model, no tools): runtime flaw or application flaw, for keyword-only CVEs."""

from __future__ import annotations

import json
from typing import Any

from agents import Agent

from ..config import get_settings
from ..triage import Inventory, runtime_name
from .common import model_settings
from .models import TriageReport

INSTRUCTIONS = """You are the Triage agent of Sentinel, the security team of a small online coffee roaster.
The CVEs below mention a language our services run, but NVD has no CPE data for them, so code cannot
tell whether they affect us. For each CVE decide whether the flaw is in the language runtime itself
(for PHP: the PHP interpreter, php-src) or in an application, CMS, plugin or library written in that
language. We only run the language runtimes: none of those applications are in our inventory.

Return exactly one verdict per CVE, in input order, with the CVE id unchanged. product = the affected
product as the description names it. reason = one short sentence naming that product, for example
"affects itsourcecode Online Cake Ordering System, not in our inventory"."""


def build_triage_agent() -> Agent:
    model = get_settings().model_fast
    return Agent(
        name="Triage",
        instructions=INSTRUCTIONS,
        model=model,
        model_settings=model_settings(model),
        output_type=TriageReport,
    )


def triage_input(candidates: list[dict[str, Any]], services: list[dict[str, Any]], inventory: Inventory) -> str:
    payload = {
        "inventory": [
            {
                "service": s["name"],
                "runtime": f"{runtime_name(s['language'])} {s.get('runtime_version') or ''}".strip(),
                "runtime_mode": s.get("runtime_mode"),
            }
            for s in services
        ],
        "keyword_languages": [runtime_name(lang) for lang in inventory.keyword_languages],
        "cves": [{"cve_id": row["cve_id"], "text": (row.get("description") or "")[:300]} for row in candidates],
    }
    return json.dumps(payload, indent=1)
