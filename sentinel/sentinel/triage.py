"""Stage 1 (code): CPE vendor:product vs inventory -> MATCHED, keyword only -> CANDIDATE, else DISMISSED.
Plus the rule that stands in for the Triage agent when no LLM is available."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from .tools.nvd import RUNTIME_CPES, cpe_products

MATCHED = "MATCHED"
CANDIDATE = "CANDIDATE"
DISMISSED = "DISMISSED"
RUNTIME_NAMES = {"php": "PHP", "python": "Python", "node": "Node.js", "ruby": "Ruby"}


def runtime_name(language: str) -> str:
    return RUNTIME_NAMES.get(language, language.capitalize())


@dataclass(frozen=True)
class Inventory:
    services_by_language: dict[str, tuple[str, ...]]
    # Keyword candidates only for web-serving runtimes (services with a sentinel.runtime_mode label);
    # other languages are matched on CPE data alone.
    keyword_languages: tuple[str, ...]

    @classmethod
    def from_services(cls, services: list[dict]) -> Inventory:
        by_language: dict[str, list[str]] = {}
        keyword: list[str] = []
        for service in services:
            language = (service.get("language") or "").lower()
            if not language:
                continue
            by_language.setdefault(language, []).append(service["name"])
            if service.get("runtime_mode") and language not in keyword:
                keyword.append(language)
        return cls({k: tuple(v) for k, v in by_language.items()}, tuple(keyword))

    def describe(self) -> str:
        return ", ".join(f"{runtime_name(lang)} ({', '.join(names)})" for lang, names in self.services_by_language.items())


def _keyword_hits(description: str, inventory: Inventory) -> list[str]:
    return [lang for lang in inventory.keyword_languages if re.search(rf"\b{re.escape(lang)}\b", description, re.IGNORECASE)]


def classify(row: dict[str, Any], inventory: Inventory) -> dict[str, Any]:
    """Stage 1 verdict for one cve_events row (id, description, cpes)."""
    description = row.get("description") or ""
    products = cpe_products(row.get("cpes") or [])
    hits = _keyword_hits(description, inventory)
    result: dict[str, Any] = {"id": row.get("id"), "cve_id": row.get("cve_id"), "keyword_match": bool(hits), "component": None}

    for language, services in inventory.services_by_language.items():
        cpe = RUNTIME_CPES.get(language)
        if cpe and cpe in products:
            result.update(
                triage_status=MATCHED,
                component=language,
                triage_reason=f"CPE cpe:2.3:a:{cpe[0]}:{cpe[1]} matches the {runtime_name(language)} runtime of "
                f"{', '.join(services)}",
            )
            return result
    if hits:
        result.update(
            triage_status=CANDIDATE,
            triage_reason=f"Mentions {runtime_name(hits[0])} but has no CPE data: waiting for the Triage agent",
        )
        return result
    if products:
        named = ", ".join(sorted(f"{v}:{p}" for v, p in products))
        reason = f"CPE data names {named}, which is not in our inventory"
    else:
        reason = "No CPE data and no mention of a runtime we run"
    result.update(triage_status=DISMISSED, triage_reason=reason)
    return result


# --- rule fallback for the Triage agent ---------------------------------------------------------

_HASH_OR_VERSION = r"(?:v?\d[\w.\-]*|[0-9a-f]{7,40})"
_PRODUCT_PATTERNS = (
    re.compile(r"^(?:The\s+)?(?P<p>.+?)\s+(?P<kind>plugins?|themes?|extensions?)\s+for\s+(?P<host>\w+)", re.IGNORECASE),
    re.compile(
        rf"\b(?:found|identified|detected|discovered|determined)\s+in\s+(?P<p>.+?)(?:\s+(?:up to|before|through|prior to)\b|\s+{_HASH_OR_VERSION}(?:[\s.,/]|$)|[.,;]|$)",
        re.IGNORECASE,
    ),
    re.compile(r"^(?P<p>.+?)\s+(?:before|through|up to|prior to|versions?)\s+v?\d", re.IGNORECASE),
    re.compile(r"^(?P<p>.+?)\s+(?:contains?|is|are|has|allows?|extracts?)\b", re.IGNORECASE),
)


def guess_product(description: str) -> str:
    text = description.strip()
    for pattern in _PRODUCT_PATTERNS:
        match = pattern.search(text)
        if not match:
            continue
        product = match.group("p").strip(" .,")
        if "kind" in pattern.groupindex:
            product = f"{product} ({match.group('host')} {match.group('kind').lower()})"
        if 2 <= len(product) <= 80:
            return product
    return "an application"


def rule_verdict(row: dict[str, Any], inventory: Inventory) -> dict[str, Any]:
    """A CVE in the runtime itself starts with the runtime's own name ('PHP uses longjmp() ...').
    'PHPOffice PHPPresentation ...' does not count: the name must be followed by a space."""
    description = row.get("description") or ""
    hits = _keyword_hits(description, inventory) or list(inventory.keyword_languages)
    for language in hits:
        name = runtime_name(language)
        if description.startswith(name + " "):
            return {
                "cve_id": row["cve_id"],
                "is_runtime_vuln": True,
                "language": language,
                "product": name,
                "reason": f"Rule: the description names the {name} runtime itself",
            }
    language = hits[0] if hits else ""
    product = guess_product(description)
    return {
        "cve_id": row["cve_id"],
        "is_runtime_vuln": False,
        "language": language,
        "product": product,
        "reason": f"Rule: affects {product}, not the {runtime_name(language)} runtime itself; not in our inventory",
    }


def decide(row: dict[str, Any], verdict: dict[str, Any] | None, inventory: Inventory) -> tuple[dict[str, Any], str | None]:
    """Turn a Triage agent verdict (or the rule when it is missing) into a cve_events update.
    A runtime match without CPE data needs the rule to agree; returns (update, warning)."""
    rule = rule_verdict(row, inventory)
    chosen = verdict or rule
    update: dict[str, Any] = {"id": row["id"], "cve_id": row["cve_id"], "component": None, "keyword_match": True}
    warning = None
    if chosen.get("is_runtime_vuln"):
        if rule["is_runtime_vuln"]:
            update.update(triage_status=MATCHED, component=rule["language"], triage_reason=chosen["reason"])
        else:
            warning = f"{row['cve_id']}: Triage agent suspected the runtime itself, but there is no CPE data and the description does not name it"
            update.update(
                triage_status=DISMISSED,
                triage_reason=f"Needs CPE data before Sentinel acts on it. Agent note: {chosen['reason']}",
            )
    else:
        update.update(triage_status=DISMISSED, triage_reason=chosen["reason"])
    return update, warning
