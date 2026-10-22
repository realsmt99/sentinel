import pytest

from sentinel.scoring import advisory_facts, assess_version
from sentinel.tools.nvd import branch_of, branch_status, extract_ranges


def test_php2shell_cpe_ranges(feed):
    ranges = extract_ranges(feed["CVE-2026-109618"]["cpes"], "php", "php")
    assert [(r.start_including, r.end_excluding) for r in ranges] == [
        (None, "8.2.35"),
        ("8.3.0", "8.3.36"),
        ("8.4.0", "8.4.27"),
        ("8.5.0", "8.5.12"),
    ]
    assert extract_ranges(feed["CVE-2026-109618"]["cpes"], "python", "python") == []


@pytest.mark.parametrize(
    ("version", "affected", "fixed"),
    [
        ("5.6.40", True, None),
        ("7.4.33", True, None),
        ("8.1.2", True, None),  # inside '< 8.2.35' (no start), but 8.2.35 is not an 8.1 release
        ("8.2.34", True, "8.2.35"),
        ("8.2.35", False, None),
        ("8.3.30", True, "8.3.36"),
        ("8.3.36", False, None),
        ("8.4.20", True, "8.4.27"),
        ("8.4.27", False, None),
        ("8.5.11", True, "8.5.12"),
        ("8.5.12", False, None),
        ("8.6.0", False, None),
    ],
)
def test_fix_lookup_is_per_branch(php_ranges, version, affected, fixed):
    status = branch_status(version, php_ranges)
    assert (status.affected, status.fixed_version) == (affected, fixed)
    assert status.branch == branch_of(version)


def test_first_range_note_warns_about_older_branches(php_ranges):
    note = php_ranges[0].to_json()["note"]
    assert "8.2.35" in note and "older" in note


def test_below_min_supported_branch_counts_as_no_official_fix(facts):
    verdict = assess_version("8.1.2", facts)
    assert verdict.affected and verdict.no_official_fix and verdict.fixed_version is None
    verdict = assess_version("8.2.10", facts)
    assert verdict.affected and not verdict.no_official_fix and verdict.fixed_version == "8.2.35"


def test_advisory_only_fallback_without_nvd_ranges(intel):
    facts = advisory_facts("php", intel, ranges=(), cvss=9.2)
    assert assess_version("8.3.30", facts).fixed_version == "8.3.36"
    assert not assess_version("8.3.36", facts).affected
    old = assess_version("8.0.30", facts)
    assert old.affected and old.no_official_fix
