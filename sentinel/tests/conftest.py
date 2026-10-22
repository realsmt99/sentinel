import json

import pytest

from sentinel.config import INTEL_FIXTURE
from sentinel.feed import load_fixture
from sentinel.scoring import ServiceFacts, advisory_facts
from sentinel.tools.nvd import dedupe_ranges, extract_ranges

PHP2SHELL = ("CVE-2026-109618", "CVE-2026-109619")


@pytest.fixture(scope="session")
def feed_rows():
    return [{"id": i, **row} for i, row in enumerate(load_fixture(), start=1)]


@pytest.fixture(scope="session")
def feed(feed_rows):
    return {row["cve_id"]: row for row in feed_rows}


@pytest.fixture(scope="session")
def intel():
    return json.loads(INTEL_FIXTURE.read_text())


@pytest.fixture(scope="session")
def php_ranges(feed):
    return dedupe_ranges([r for cve in PHP2SHELL for r in extract_ranges(feed[cve]["cpes"], "php", "php")])


@pytest.fixture(scope="session")
def facts(feed, intel, php_ranges):
    return advisory_facts("php", intel, php_ranges, cvss=max(feed[cve]["cvss"] for cve in PHP2SHELL))


@pytest.fixture
def shop():
    return ServiceFacts("shop", "php", "8.3.30", "apache2handler", "public", 40000)


@pytest.fixture
def admin_panel():
    return ServiceFacts("admin-panel", "php", "8.4.20", "fpm-fcgi", "internal", 0)


@pytest.fixture
def billing_worker():
    return ServiceFacts("billing-worker", "python", "3.12.13", None, "internal", 15000)
