"""Shared agent plumbing: the per-advisory run context and model settings."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from agents import ModelSettings
from openai.types.shared import Reasoning

from ..config import get_settings
from ..scoring import AdvisoryFacts

_REASONING_PREFIXES = ("gpt-5", "o1", "o3", "o4")


@dataclass
class AdvisoryContext:
    """Run context handed to every agent of one advisory (Runner.run(context=...))."""

    component: str
    cve_ids: list[str]
    intel: dict[str, Any] = field(default_factory=dict)
    facts: AdvisoryFacts | None = None
    slug: str = ""
    service: str | None = None  # the lane's service: per-service tools refuse other names
    alerts: list[dict[str, Any]] = field(default_factory=list)
    pr_results: list[dict[str, Any]] = field(default_factory=list)
    tag_checks: list[dict[str, Any]] = field(default_factory=list)

    def for_service(self, name: str) -> AdvisoryContext:
        return AdvisoryContext(self.component, self.cve_ids, self.intel, self.facts, self.slug, name)

    @property
    def title(self) -> str:
        return self.intel.get("title") or f"{self.component} advisory {', '.join(self.cve_ids)}"

    @property
    def short_name(self) -> str:
        title = self.intel.get("title") or ""
        return title.split(":", 1)[0].strip() if ":" in title else ", ".join(self.cve_ids)


def model_settings(model: str, **kwargs: Any) -> ModelSettings:
    """Low reasoning effort for reasoning models keeps the demo fast; OPENAI_REASONING_EFFORT overrides
    ('off' sends no reasoning parameter)."""
    effort = get_settings().reasoning_effort
    if effort is None and model.startswith(_REASONING_PREFIXES):
        effort = "low"
    if effort and effort.lower() != "off":
        kwargs["reasoning"] = Reasoning(effort=effort)
    return ModelSettings(**kwargs)
