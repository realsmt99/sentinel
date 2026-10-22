from dataclasses import replace

import pytest

from sentinel.scoring import (
    DIGEST,
    NONE,
    PR_ONLY,
    TAKE_OFFLINE,
    advisory_facts,
    band_for,
    danger_score,
    normalize_runtime_mode,
)


def test_feed_parser_prefers_cvss_v4(feed):
    for cve in ("CVE-2026-109618", "CVE-2026-109619"):
        assert feed[cve]["cvss"] == 9.2
        assert feed[cve]["cvss_version"] == "4.0"


def test_shop_is_taken_offline(facts, shop):
    result = danger_score(shop, facts)
    assert result.score == 92
    assert result.band == TAKE_OFFLINE
    assert result.breakdown == {
        "severity": 36.8,
        "exploitation": 20,
        "exposure": 20,
        "runtime_mode": 10,
        "revenue": 5,
        "no_official_fix": 0,
    }
    assert result.fixed_version == "8.3.36"


def test_admin_panel_gets_a_pr(facts, admin_panel):
    result = danger_score(admin_panel, facts)
    assert result.score == 67
    assert result.band == PR_ONLY
    assert result.breakdown["exposure"] == 5
    assert result.breakdown["runtime_mode"] == 5
    assert result.breakdown["revenue"] == 0
    assert result.fixed_version == "8.4.27"


def test_billing_worker_is_not_affected(facts, billing_worker):
    result = danger_score(billing_worker, facts)
    assert (result.score, result.band, result.affected) == (0, NONE, False)
    assert result.breakdown == {}


def test_patched_shop_scores_zero(facts, shop):
    result = danger_score(replace(shop, runtime_version="8.3.36"), facts)
    assert (result.score, result.band) == (0, NONE)


def test_unsupported_branch_has_no_official_fix(facts, shop):
    result = danger_score(replace(shop, runtime_version="8.1.2"), facts)
    assert result.affected
    assert result.score >= 80
    assert result.band == TAKE_OFFLINE
    assert result.no_official_fix
    assert result.fixed_version is None
    assert result.breakdown["no_official_fix"] == 15


def test_score_is_capped_at_100(facts, shop):
    assert danger_score(replace(shop, runtime_version="7.4.33"), facts).score == 100


@pytest.mark.parametrize(
    ("score", "band"),
    [(100, TAKE_OFFLINE), (80, TAKE_OFFLINE), (79, PR_ONLY), (50, PR_ONLY), (49, DIGEST), (1, DIGEST), (0, NONE)],
)
def test_bands(score, band):
    assert band_for(score) == band


def test_advisory_wording_for_runtime_modes_is_normalized(intel, php_ranges, shop):
    facts = advisory_facts("php", {**intel, "high_risk_runtime_modes": ["Apache mod_php"]}, php_ranges, cvss=9.2)
    assert danger_score(shop, facts).score == 92
    assert normalize_runtime_mode("PHP-FPM") == "fpm-fcgi"


def test_exploitation_evidence_moves_the_band(intel, php_ranges, shop):
    facts = advisory_facts("php", {**intel, "exploitation_reported": False}, php_ranges, cvss=9.2)
    result = danger_score(shop, facts)
    assert (result.score, result.band) == (72, PR_ONLY)


def test_nvd_primary_v31_score_would_change_the_numbers(intel, php_ranges, shop, admin_panel):
    facts = advisory_facts("php", intel, php_ranges, cvss=9.8)
    assert danger_score(shop, facts).score == 94
    assert danger_score(admin_panel, facts).score == 69
