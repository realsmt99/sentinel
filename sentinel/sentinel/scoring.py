"""Danger score (plan section 3). Pure functions: zero unless the installed version is affected.

  severity        CVSS x 4 (max 40)
  exploitation    +20 when any credible source reports exploitation
  exposure        public +20, internal +5
  runtime_mode    +10 when the advisory names the service's runtime mode high-risk, else +5
  revenue         +5 at >= 10k EUR/month
  no_official_fix +15 when the installed branch has no official fix
  cap 100; bands >= 80 TAKE_OFFLINE, 50-79 PR_ONLY, 1-49 DIGEST, 0 NONE
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from packaging.version import InvalidVersion

from .tools.nvd import CpeRange, branch_key, branch_of, branch_status, parse_version
from .triage import runtime_name

TAKE_OFFLINE = "TAKE_OFFLINE"
PR_ONLY = "PR_ONLY"
DIGEST = "DIGEST"
NONE = "NONE"
FIX_BANDS = frozenset({TAKE_OFFLINE, PR_ONLY, DIGEST})
OFFLINE_THRESHOLD = 80
REVENUE_THRESHOLD_EUR = 10_000

_MODE_ALIASES = {
    "apache2handler": "apache2handler",
    "mod_php": "apache2handler",
    "modphp": "apache2handler",
    "apache": "apache2handler",
    "apache2": "apache2handler",
    "apache mod_php": "apache2handler",
    "fpm-fcgi": "fpm-fcgi",
    "fpm": "fpm-fcgi",
    "php-fpm": "fpm-fcgi",
    "cgi-fcgi": "cgi-fcgi",
    "cgi": "cgi-fcgi",
    "php-cgi": "cgi-fcgi",
    "fastcgi": "cgi-fcgi",
    "cli": "cli",
    "litespeed": "litespeed",
    "frankenphp": "frankenphp",
}


def normalize_runtime_mode(value: str | None) -> str | None:
    """Map advisory wording (mod_php, PHP-FPM, ...) to PHP_SAPI names (apache2handler, fpm-fcgi, ...)."""
    if not value:
        return None
    text = value.strip().lower()
    if text in _MODE_ALIASES:
        return _MODE_ALIASES[text]
    if "mod_php" in text or "apache2handler" in text or text.startswith("apache"):
        return "apache2handler"
    if "fpm" in text:
        return "fpm-fcgi"
    if "cgi" in text:
        return "cgi-fcgi"
    return text


def band_for(score: int) -> str:
    if score >= OFFLINE_THRESHOLD:
        return TAKE_OFFLINE
    if score >= 50:
        return PR_ONLY
    if score >= 1:
        return DIGEST
    return NONE


@dataclass(frozen=True)
class ServiceFacts:
    name: str
    language: str
    runtime_version: str | None
    runtime_mode: str | None = None
    exposure: str = "internal"
    monthly_revenue_eur: int = 0

    @classmethod
    def from_row(cls, row: dict) -> ServiceFacts:
        return cls(
            name=row["name"],
            language=(row.get("language") or "").lower(),
            runtime_version=row.get("runtime_version"),
            runtime_mode=row.get("runtime_mode"),
            exposure=row.get("exposure") or "internal",
            monthly_revenue_eur=int(row.get("monthly_revenue_eur") or 0),
        )


@dataclass(frozen=True)
class AdvisoryFacts:
    component: str
    cvss: float
    exploitation_reported: bool
    high_risk_runtime_modes: frozenset[str] = frozenset()
    fixed_versions: dict[str, str] = field(default_factory=dict)  # branch -> official fixed release
    min_supported_branch: str | None = None
    ranges: tuple[CpeRange, ...] = ()


@dataclass(frozen=True)
class VersionVerdict:
    affected: bool
    branch: str | None
    fixed_version: str | None
    no_official_fix: bool
    reason: str


def assess_version(version: str, facts: AdvisoryFacts) -> VersionVerdict:
    """Per major.minor branch. NVD ranges decide whether the version is affected (advisory fixed
    versions when NVD has none); the fix must be on the installed branch, and branches below
    min_supported_branch have no official fix."""
    try:
        installed = parse_version(version)
        branch = branch_of(version)
    except InvalidVersion:
        return VersionVerdict(False, None, None, False, f"cannot parse version {version!r}")

    below_supported = bool(facts.min_supported_branch) and branch_key(branch) < branch_key(facts.min_supported_branch)
    fixed = facts.fixed_versions.get(branch)
    if fixed and parse_version(fixed) <= installed:
        fixed = None if facts.ranges else fixed

    if facts.ranges:
        status = branch_status(version, facts.ranges)
        if not status.affected:
            return VersionVerdict(False, branch, facts.fixed_versions.get(branch), False,
                                  f"{version} is outside every NVD affected range")
        fixed = fixed or status.fixed_version
    elif fixed is not None:
        if installed >= parse_version(fixed):
            return VersionVerdict(False, branch, fixed, False, f"{version} already includes the {branch} fix {fixed}")
    elif not below_supported:
        return VersionVerdict(False, branch, None, False, f"no affected range known for branch {branch}")

    if below_supported or fixed is None:
        return VersionVerdict(True, branch, None, True,
                              f"{version} is affected and branch {branch} has no official fix")
    return VersionVerdict(True, branch, fixed, False, f"{version} is affected; the {branch} branch is fixed in {fixed}")


@dataclass(frozen=True)
class ScoreResult:
    service: str
    score: int
    band: str
    affected: bool
    breakdown: dict[str, float]
    raw: float
    installed_version: str | None
    branch: str | None
    fixed_version: str | None
    no_official_fix: bool
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "service": self.service,
            "score": self.score,
            "band": self.band,
            "affected": self.affected,
            "breakdown": self.breakdown,
            "raw_score": round(self.raw, 1),
            "installed_version": self.installed_version,
            "branch": self.branch,
            "fixed_version": self.fixed_version,
            "no_official_fix": self.no_official_fix,
            "reason": self.reason,
        }

    def summary(self) -> str:
        if not self.affected:
            return f"{self.service}: {self.score} {self.band} ({self.reason})"
        parts = " + ".join(f"{k.replace('_', ' ')} {v:g}" for k, v in self.breakdown.items() if v)
        return f"{self.service}: {self.score} {self.band} ({parts})"


def danger_score(service: ServiceFacts, facts: AdvisoryFacts) -> ScoreResult:
    def not_affected(reason: str, branch: str | None = None, fixed: str | None = None) -> ScoreResult:
        return ScoreResult(service.name, 0, NONE, False, {}, 0.0, service.runtime_version, branch, fixed, False, reason)

    if service.language.lower() != facts.component.lower():
        return not_affected(f"the advisory only affects {runtime_name(facts.component)}")
    if not service.runtime_version:
        return not_affected(f"{service.name}: runtime version unknown, rescan needed")

    verdict = assess_version(service.runtime_version, facts)
    if not verdict.affected:
        return not_affected(verdict.reason, verdict.branch, verdict.fixed_version)

    severity = min(facts.cvss * 4, 40.0)
    exploitation = 20 if facts.exploitation_reported else 0
    exposure = 20 if service.exposure == "public" else 5
    mode = normalize_runtime_mode(service.runtime_mode)
    runtime_mode = 10 if mode and mode in facts.high_risk_runtime_modes else 5
    revenue = 5 if service.monthly_revenue_eur >= REVENUE_THRESHOLD_EUR else 0
    no_fix = 15 if verdict.no_official_fix else 0
    raw = severity + exploitation + exposure + runtime_mode + revenue + no_fix
    score = min(100, math.floor(raw + 0.5))
    breakdown = {
        "severity": round(severity, 1),
        "exploitation": exploitation,
        "exposure": exposure,
        "runtime_mode": runtime_mode,
        "revenue": revenue,
        "no_official_fix": no_fix,
    }
    return ScoreResult(service.name, score, band_for(score), True, breakdown, raw, service.runtime_version,
                       verdict.branch, verdict.fixed_version, verdict.no_official_fix, verdict.reason)


def advisory_facts(
    component: str,
    intel: dict[str, Any],
    ranges: list[CpeRange] | tuple[CpeRange, ...] = (),
    cvss: float | None = None,
) -> AdvisoryFacts:
    """Build scoring facts from ThreatIntel data (fixed_versions as {branch: {version, source_url}} or a
    list of {branch, version, source_url}). cvss overrides the intel value (the feed's v4.0 score)."""
    raw_fixed = intel.get("fixed_versions") or {}
    entries = raw_fixed.items() if isinstance(raw_fixed, dict) else ((e.get("branch"), e) for e in raw_fixed)
    fixed: dict[str, str] = {}
    for _branch, entry in entries:
        version = entry.get("version") if isinstance(entry, dict) else entry
        try:
            fixed[branch_of(str(version))] = str(parse_version(str(version)))
        except (InvalidVersion, TypeError):
            continue

    min_branch = intel.get("min_supported_branch")
    try:
        min_branch = branch_of(str(min_branch)) if min_branch else None
    except InvalidVersion:
        min_branch = None
    if not min_branch and fixed:
        min_branch = min(fixed, key=branch_key)

    modes = frozenset(m for m in (normalize_runtime_mode(x) for x in intel.get("high_risk_runtime_modes") or []) if m)
    score_cvss = cvss if cvss is not None else float(intel.get("cvss") or 0.0)
    return AdvisoryFacts(
        component=component,
        cvss=float(score_cvss),
        exploitation_reported=bool(intel.get("exploitation_reported")),
        high_risk_runtime_modes=modes,
        fixed_versions=fixed,
        min_supported_branch=min_branch,
        ranges=tuple(ranges),
    )
