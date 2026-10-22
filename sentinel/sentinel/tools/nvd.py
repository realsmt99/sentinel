"""NVD CPE ranges: pure parsing helpers and the get_nvd_ranges reader over cve_events.cpes."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from packaging.version import InvalidVersion, Version

from ..config import NVD_FIXTURE

# Inventory language (services.language) -> CPE vendor:product of the runtime itself.
RUNTIME_CPES: dict[str, tuple[str, str]] = {
    "php": ("php", "php"),
    "python": ("python", "python"),
    "node": ("nodejs", "node.js"),
    "ruby": ("ruby-lang", "ruby"),
}

_VERSION_RE = re.compile(r"\d+(?:\.\d+)*")


def parse_version(value: str) -> Version:
    match = _VERSION_RE.search(value or "")
    if not match:
        raise InvalidVersion(f"no version number in {value!r}")
    return Version(match.group(0))


def branch_of(value: str) -> str:
    """'8.3.30' -> '8.3'."""
    version = parse_version(value)
    return f"{version.major}.{version.minor}"


def branch_key(branch: str) -> tuple[int, int]:
    version = parse_version(branch)
    return (version.major, version.minor)


def cpe_parts(criteria: str) -> tuple[str, str, str]:
    """'cpe:2.3:a:php:php:*:...' -> ('php', 'php', '*')."""
    parts = criteria.split(":")
    if len(parts) < 6:
        return ("", "", "*")
    return (parts[3], parts[4], parts[5])


@dataclass(frozen=True)
class CpeRange:
    criteria: str
    vendor: str
    product: str
    version: str | None = None
    start_including: str | None = None
    start_excluding: str | None = None
    end_including: str | None = None
    end_excluding: str | None = None

    @property
    def has_start(self) -> bool:
        return bool(self.start_including or self.start_excluding)

    def contains(self, version: str) -> bool:
        v = parse_version(version)
        if self.version:
            return v == parse_version(self.version)
        if self.start_including and v < parse_version(self.start_including):
            return False
        if self.start_excluding and v <= parse_version(self.start_excluding):
            return False
        if self.end_including and v > parse_version(self.end_including):
            return False
        if self.end_excluding and v >= parse_version(self.end_excluding):
            return False
        return True

    def to_json(self) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "cpe": f"cpe:2.3:a:{self.vendor}:{self.product}",
            "versionStartIncluding": self.start_including,
            "versionStartExcluding": self.start_excluding,
            "versionEndIncluding": self.end_including,
            "versionEndExcluding": self.end_excluding,
        }
        if self.version:
            entry["version"] = self.version
        if self.end_excluding:
            entry["fixed_branch"] = branch_of(self.end_excluding)
            entry["fixed_version"] = self.end_excluding
            if not self.has_start:
                entry["note"] = (
                    f"No start version: every release below {self.end_excluding} is affected, including branches "
                    f"older than {branch_of(self.end_excluding)}. {self.end_excluding} only fixes the "
                    f"{branch_of(self.end_excluding)} branch; older branches get no fix from this range."
                )
        return {k: v for k, v in entry.items() if v is not None}


def iter_cpe_matches(configurations: Any) -> Iterator[dict]:
    for config in configurations or []:
        for node in config.get("nodes", []) or []:
            yield from node.get("cpeMatch", []) or []


def extract_ranges(configurations: Any, vendor: str | None = None, product: str | None = None) -> list[CpeRange]:
    """Vulnerable cpeMatch entries of NVD cve.configurations, optionally filtered by vendor:product."""
    ranges: list[CpeRange] = []
    for match in iter_cpe_matches(configurations):
        if not match.get("vulnerable", True):
            continue
        v, p, exact = cpe_parts(match.get("criteria", ""))
        if (vendor and v != vendor) or (product and p != product):
            continue
        ranges.append(
            CpeRange(
                criteria=match["criteria"],
                vendor=v,
                product=p,
                version=None if exact in {"*", "-", ""} else exact,
                start_including=match.get("versionStartIncluding"),
                start_excluding=match.get("versionStartExcluding"),
                end_including=match.get("versionEndIncluding"),
                end_excluding=match.get("versionEndExcluding"),
            )
        )
    return ranges


def cpe_products(configurations: Any) -> set[tuple[str, str]]:
    return {(r.vendor, r.product) for r in extract_ranges(configurations)}


@dataclass(frozen=True)
class BranchStatus:
    version: str
    branch: str
    affected: bool
    fixed_version: str | None
    matched_range: CpeRange | None


def branch_status(version: str, ranges: list[CpeRange] | tuple[CpeRange, ...]) -> BranchStatus:
    """Affected if any range contains the version. The range end only counts as the fix when it is on
    the installed major.minor branch: '< 8.2.35' without a start also covers 8.1, which 8.2.35 does not fix."""
    branch = branch_of(version)
    for r in ranges:
        if r.contains(version):
            fixed = r.end_excluding if r.end_excluding and branch_of(r.end_excluding) == branch else None
            return BranchStatus(version, branch, True, fixed, r)
    return BranchStatus(version, branch, False, None, None)


def dedupe_ranges(ranges: list[CpeRange]) -> list[CpeRange]:
    seen: set[tuple] = set()
    unique: list[CpeRange] = []
    for r in ranges:
        key = (r.vendor, r.product, r.version, r.start_including, r.start_excluding, r.end_including, r.end_excluding)
        if key not in seen:
            seen.add(key)
            unique.append(r)
    return unique


# --- raw NVD record (fixture) -------------------------------------------------------------------


@lru_cache(maxsize=1)
def _nvd_index() -> dict[str, dict]:
    try:
        data = json.loads(NVD_FIXTURE.read_text())
    except (OSError, ValueError):
        return {}
    return {v["cve"]["id"]: v["cve"] for v in data.get("vulnerabilities", [])}


def nvd_ssvc(cve_id: str) -> dict | None:
    """CISA's SSVC assessment as published in the NVD record, e.g. {'exploitation': 'none', ...}."""
    cve = _nvd_index().get(cve_id)
    if not cve:
        return None
    for metric in cve.get("metrics", {}).get("ssvcV203", []):
        data = metric.get("ssvcData", {})
        assessment: dict[str, Any] = {"role": data.get("role"), "timestamp": data.get("timestamp")}
        for option in data.get("options", []):
            assessment.update(option)
        return assessment
    return None


# --- database readers ---------------------------------------------------------------------------


def component_ranges(component: str) -> list[CpeRange]:
    """Union of the runtime's CPE ranges over every MATCHED CVE of the advisory component."""
    from .. import db

    vendor, product = RUNTIME_CPES.get(component, (component, component))
    ranges: list[CpeRange] = []
    for row in db.matched_cves(component):
        ranges.extend(extract_ranges(row["cpes"], vendor, product))
    return dedupe_ranges(ranges)


def get_nvd_ranges(cve_id: str) -> dict[str, Any]:
    """NVD data for one CVE from cve_events: CVSS, per-branch ranges and CISA's SSVC assessment."""
    from .. import db

    row = db.cve_by_id(cve_id.strip().upper())
    if not row:
        return {"cve_id": cve_id, "error": "CVE not found in cve_events"}
    ranges = extract_ranges(row["cpes"])
    return {
        "cve_id": row["cve_id"],
        "published": row["published"].isoformat() if row.get("published") else None,
        "cvss": row["cvss"],
        "cvss_version": row["cvss_version"],
        "description": row["description"],
        "ranges": [r.to_json() for r in ranges],
        "fixed_by_branch": {
            branch_of(r.end_excluding): r.end_excluding for r in ranges if r.end_excluding
        },
        "cisa_ssvc": nvd_ssvc(row["cve_id"]),
    }
