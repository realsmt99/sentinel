from collections import Counter

import pytest

from sentinel.triage import CANDIDATE, DISMISSED, MATCHED, Inventory, classify, decide, guess_product, rule_verdict

INVENTORY = Inventory.from_services(
    [
        {"name": "shop", "language": "php", "runtime_mode": "apache2handler"},
        {"name": "admin-panel", "language": "php", "runtime_mode": "fpm-fcgi"},
        {"name": "billing-worker", "language": "python", "runtime_mode": None},
    ]
)


@pytest.fixture(scope="module")
def stage1(feed_rows):
    return [classify(row, INVENTORY) for row in feed_rows]


def test_stage1_funnel_over_the_real_feed(feed_rows, stage1):
    assert len(feed_rows) == 544
    counts = Counter(r["triage_status"] for r in stage1)
    assert counts == {MATCHED: 2, CANDIDATE: 38, DISMISSED: 504}
    assert sum(r["keyword_match"] for r in stage1) == 40
    matched = {r["cve_id"]: r["component"] for r in stage1 if r["triage_status"] == MATCHED}
    assert matched == {"CVE-2026-109618": "php", "CVE-2026-109619": "php"}


def test_rule_fallback_dismisses_every_candidate(feed, stage1):
    candidates = [feed[r["cve_id"]] for r in stage1 if r["triage_status"] == CANDIDATE]
    updates = [decide(row, None, INVENTORY) for row in candidates]
    assert all(update["triage_status"] == DISMISSED and warning is None for update, warning in updates)


def test_rule_needs_the_runtime_name_followed_by_a_space(feed):
    assert rule_verdict(feed["CVE-2026-109618"], INVENTORY)["is_runtime_vuln"]
    assert rule_verdict(feed["CVE-2026-109619"], INVENTORY)["is_runtime_vuln"]
    for cve in ("CVE-2026-114403", "CVE-2026-114404"):  # PHPOffice PHPPresentation
        assert not rule_verdict(feed[cve], INVENTORY)["is_runtime_vuln"]


def test_agent_runtime_claim_without_cpe_needs_the_rule_to_agree(feed):
    claim = {"cve_id": "CVE-2026-114403", "is_runtime_vuln": True, "product": "PHP", "reason": "PHP object injection"}
    update, warning = decide(feed["CVE-2026-114403"], claim, INVENTORY)
    assert update["triage_status"] == DISMISSED
    assert warning


@pytest.mark.parametrize(
    ("cve", "product"),
    [
        ("CVE-2026-113740", "itsourcecode Online Cake Ordering System"),
        ("CVE-2026-114048", "WWBN AVideo"),
        ("CVE-2026-114403", "PHPOffice PHPPresentation"),
        ("CVE-2026-114262", "file-management-system"),
        ("CVE-2026-114242", "dhikshitha29 Insurance-Management-System"),
    ],
)
def test_product_names_for_dismissal_reasons(feed, cve, product):
    assert guess_product(feed[cve]["description"]) == product
