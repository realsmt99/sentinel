"""Pydantic outputs of the five agents. Every agent run is schema-validated against one of these."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_serializer, field_validator


class TriageVerdict(BaseModel):
    cve_id: str
    is_runtime_vuln: bool = Field(
        description="True only when the flaw is in the language runtime itself (e.g. php-src, the PHP interpreter), "
        "false when it is in an application, CMS, plugin or library written in that language."
    )
    product: str = Field(description="Affected product as named in the description, e.g. 'itsourcecode Online Cake Ordering System'.")
    reason: str = Field(description="One short sentence, e.g. 'affects itsourcecode Online Cake Ordering System, not in our inventory'.")


class TriageReport(BaseModel):
    verdicts: list[TriageVerdict]


class Source(BaseModel):
    url: str
    title: str
    claim: str = Field(description="The fact this page supports, in one sentence.")


class FixedVersion(BaseModel):
    branch: str = Field(description="major.minor branch, e.g. '8.3'.")
    version: str = Field(description="Official fixed release on that branch, e.g. '8.3.36'.")
    source_url: str


class ThreatIntel(BaseModel):
    """Threat Intel agent output. Stored in threat_intel.data with fixed_versions as {branch: {version, source_url}}."""

    title: str = Field(description="Advisory name, e.g. 'PHP2Shell: unauthenticated RCE in PHP (CVE-...)'.")
    summary: str = Field(description="Two sentences: what is broken and what to do.")
    cvss: float = Field(description="Base score. Prefer CVSS v4.0 from the CNA (security@php.net) when present.")
    cvss_version: str = Field(description="'4.0', '3.1', ...")
    exploitation_reported: bool = Field(
        description="True when any credible source reports exploitation or exploitation attempts in the wild."
    )
    exploitation_evidence: str = Field(description="Who observed what and when, with the source.")
    high_risk_runtime_modes: list[str] = Field(
        description="PHP_SAPI names the advisory singles out as highest risk, e.g. ['apache2handler'] for Apache mod_php."
    )
    runtime_mode_notes: str = Field(description="How the risk differs per runtime mode (mod_php, PHP-FPM, CGI).")
    fixed_versions: list[FixedVersion] = Field(description="One entry per supported branch with an official fix.")
    min_supported_branch: str = Field(description="Oldest branch that received an official fixed release, e.g. '8.2'.")
    unsupported_branches: list[str] = Field(description="Affected branches without an official release, e.g. ['7.4', '8.0', '8.1'].")
    conflicts: list[str] = Field(description="Disagreements between sources, e.g. 'CISA (Oct 21): not observed as of publication'.")
    sources: list[Source]

    @field_validator("fixed_versions", mode="before")
    @classmethod
    def _accept_branch_map(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return [
                {"branch": branch, **(entry if isinstance(entry, dict) else {"version": entry, "source_url": ""})}
                for branch, entry in value.items()
            ]
        return value

    @field_serializer("fixed_versions")
    def _dump_branch_map(self, value: list[FixedVersion]) -> dict[str, dict[str, str]]:
        return {fv.branch: {"version": fv.version, "source_url": fv.source_url} for fv in value}

    def data(self) -> dict[str, Any]:
        return self.model_dump(mode="json")


class RiskAssessment(BaseModel):
    service: str
    score: int = Field(description="Exactly the score returned by compute_danger_score.")
    band: str = Field(description="Exactly the band returned by compute_danger_score.")
    explanation: str = Field(description="Two sentences for a business owner: what is at stake and why this band.")


class ContainmentReport(BaseModel):
    service: str
    offline: bool
    alert_sent: bool
    message: str = Field(description="One sentence on what was done and what the human should do next.")


class RemediationResult(BaseModel):
    service: str
    target_version: str
    fix_verified: bool = Field(description="An official release announcement or changelog for target_version was found.")
    docker_tag_verified: bool = Field(description="check_docker_tag confirmed the image tag exists.")
    files_changed: list[str]
    pr_url: str | None = Field(description="URL returned by open_fix_pr, null when no PR was opened.")
    notes: str = Field(description="Breaking-change warnings, skipped steps, sources.")
