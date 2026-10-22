"""Guard's chat wording and the demo baseline files, without a database."""

from __future__ import annotations

import re

import pytest

from sentinel import narrate
from sentinel.tools import github_ops


@pytest.fixture
def said(monkeypatch):
    messages: list[dict] = []
    monkeypatch.setattr(narrate, "say", lambda text, role="guard", card=None: messages.append(
        {"text": text, "role": role, "card": card}))
    monkeypatch.setattr(narrate.history, "set_title", lambda title: messages.append({"title": title}))
    return messages


def test_ranked_names_every_score_and_the_services_above_80(said):
    narrate.ranked([
        {"service": "admin-panel", "danger_score": 67},
        {"service": "shop", "danger_score": 92},
        {"service": "billing-worker", "danger_score": 0},
    ])
    text = said[0]["text"]
    assert "shop 92, admin-panel 67, billing-worker 0" in text
    assert "shop is at 80 or above" in text
    assert said[0]["card"] == {"type": "scores"}
    assert said[1] == {"title": "shop scored 92 · taken offline"}


def test_ranked_without_anything_above_80(said):
    narrate.ranked([{"service": "admin-panel", "danger_score": 67}])
    assert "Nothing reaches 80" in said[0]["text"]


def test_intel_found_mentions_the_fix_and_exploitation(said):
    narrate.intel_found({
        "cvss": 9.2,
        "exploitation_reported": True,
        "fixed_versions": {"8.3": {"version": "8.3.36"}, "8.4": {"version": "8.4.27"}},
        "sources": [{"url": "https://www.php.net/archive/2026.php"}],
        "conflicts": [{"summary": "CISA had not observed exploitation"}],
    }, cached=False)
    text = said[0]["text"]
    assert text.startswith("Here is what I found on the web: CVSS 9.2.")
    assert "Attackers are already exploiting it." in text
    assert "A fix exists: PHP 8.3.36, 8.4.27." in text
    assert "CISA had not observed exploitation" in text


def test_fix_ready_links_the_pull_request(said):
    narrate.fix_ready("shop", "https://github.com/realsmt99/sentinel/pull/7", "8.3.36", None, alerted=False)
    assert "pull request #7" in said[0]["text"]
    assert said[0]["card"] == {"type": "pr", "service": "shop", "url": "https://github.com/realsmt99/sentinel/pull/7"}


def test_merged_is_an_event_then_a_guard_message(said):
    narrate.merged("shop", 7, "realsmt99")
    assert said[0]["role"] == "event" and "#7 was merged on GitHub by realsmt99" in said[0]["text"]
    assert said[1]["role"] == "guard" and "Deploying the patched shop" in said[1]["text"]


def test_baseline_files_pin_the_vulnerable_versions():
    files = {p.relative_to(github_ops.BASELINE_DIR).as_posix(): p.read_text()
             for p in github_ops.BASELINE_DIR.rglob("*") if p.is_file()}
    assert set(files) == {
        "target-system/shop/Dockerfile", "target-system/shop/composer.json",
        "target-system/admin-panel/Dockerfile", "target-system/admin-panel/composer.json",
    }
    assert re.search(r"ARG PHP_VERSION=8\.3\.30", files["target-system/shop/Dockerfile"])
    assert re.search(r"ARG PHP_VERSION=8\.4\.20", files["target-system/admin-panel/Dockerfile"])
    assert '"php": "^8.3.30"' in files["target-system/shop/composer.json"]
