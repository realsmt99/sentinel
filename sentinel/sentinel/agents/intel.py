"""Threat Intel agent (smart model): Keenable MCP research plus NVD ranges from Guard's database."""

from __future__ import annotations

import asyncio
import json
from datetime import date
from typing import Any

from agents import Agent, function_tool

from ..config import get_settings
from ..tools import nvd
from ..tools.keenable import keenable_rest_tools
from .common import model_settings
from .models import ThreatIntel

INSTRUCTIONS = """You are the Threat Intel agent of Guard, the security team of a small online coffee
roaster that runs PHP. Research the advisory you are given and return a ThreatIntel object.

Tools:
- get_nvd_ranges(cve_id): the official NVD record from our database (CVSS, CPE version ranges, CISA's
  SSVC assessment). Call it once per CVE first.
- search_web_pages: live web search (Keenable). Describe the ideal page; use published_after for recency.
- fetch_page_content: read one page. Always pass max_chars (at most 6000) and a prompt that says exactly
  what to extract, so you only get the relevant facts.
Budget: at most 3 searches and 4 fetches in total. Prefer official sources: php.net release
announcements and security advisories, CISA, the PHP Foundation, then established security vendors.

What to establish:
- cvss / cvss_version: prefer the CVSS v4.0 score of the CNA (security@php.net) when present.
- fixed_versions: the official fixed release per supported major.minor branch, each with the URL that
  states it. NVD's first range has no start version ("< 8.2.35"): it covers 8.1 and older too, but
  8.2.35 only fixes the 8.2 branch. Never list a fix for a branch from another branch's release.
- min_supported_branch: the oldest branch with an official fixed release; unsupported_branches: affected
  branches without one (for example branches that only got source backports).
- exploitation_reported: true when ANY credible source reports exploitation or exploitation attempts in
  the wild; put who saw what and when in exploitation_evidence. When another credible source disagrees
  (for example "not observed as of publication"), keep true and record the disagreement in conflicts.
- high_risk_runtime_modes: the PHP_SAPI names the advisory singles out as highest risk
  (apache2handler = Apache mod_php, fpm-fcgi = PHP-FPM, cgi-fcgi = php-cgi); runtime_mode_notes explains
  how the risk differs per mode.
- sources: every page you relied on, each with the claim it supports.
Only state facts found in NVD or in pages you fetched or saw in search results. Be quick."""


@function_tool
async def get_nvd_ranges(cve_id: str) -> str:
    """Official NVD data for one CVE from Guard's database: CVSS, CPE version ranges per branch and
    CISA's SSVC assessment.

    Args:
        cve_id: The CVE id, e.g. CVE-2026-109618.
    """
    return json.dumps(await asyncio.to_thread(nvd.get_nvd_ranges, cve_id), default=str)


def build_intel_agent(keenable: Any | None) -> Agent:
    model = get_settings().model_smart
    tools: list[Any] = [get_nvd_ranges]
    if keenable is None:
        tools.extend(keenable_rest_tools())
    return Agent(
        name="Threat Intel",
        instructions=INSTRUCTIONS,
        model=model,
        model_settings=model_settings(model),
        tools=tools,
        mcp_servers=[keenable] if keenable is not None else [],
        output_type=ThreatIntel,
    )


def intel_input(component: str, cve_ids: list[str], cves: list[dict[str, Any]]) -> str:
    lines = [f"Advisory for the {component} runtime: {', '.join(cve_ids)}. Today is {date.today().isoformat()}.", ""]
    for cve in cves:
        lines.append(f"{cve['cve_id']} (NVD, CVSS {cve.get('cvss')} v{cve.get('cvss_version')}): {cve.get('description', '')}")
    return "\n".join(lines)


def validate_intel(intel: ThreatIntel) -> list[str]:
    """Postcondition on the agent's research; any problem sends the lane to the verified fixture."""
    problems = []
    if not intel.fixed_versions:
        problems.append("no fixed versions")
    if not 0 < intel.cvss <= 10:
        problems.append(f"cvss {intel.cvss} out of range")
    if not intel.sources:
        problems.append("no sources")
    for fixed in intel.fixed_versions:
        try:
            if nvd.branch_of(fixed.version) != nvd.branch_of(fixed.branch):
                problems.append(f"fix {fixed.version} listed for branch {fixed.branch}")
        except Exception:
            problems.append(f"bad version {fixed.version!r}")
    return problems
