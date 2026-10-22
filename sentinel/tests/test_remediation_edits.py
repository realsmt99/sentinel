import pytest

from sentinel.agents.remediation import plan_target
from sentinel.config import REPO_ROOT
from sentinel.tools.github_ops import (
    allowed_root,
    build_version_edits,
    bump_composer,
    bump_dockerfile,
    check_path,
    image_variant,
    validate_edit,
)


def _files(service: str) -> dict[str, str]:
    root = f"target-system/{service}"
    return {f"{root}/{name}": (REPO_ROOT / root / name).read_text() for name in ("Dockerfile", "composer.json")}


def test_shop_edits_change_only_the_version():
    files = _files("shop")
    edits = {e["path"]: e["content"] for e in build_version_edits("target-system/shop", "8.3.36", files)}
    assert set(edits) == set(files)
    for path, content in edits.items():
        assert content == files[path].replace("8.3.30", "8.3.36")
        validate_edit(path, content, "8.3.36")
    assert image_variant(files["target-system/shop/Dockerfile"]) == "-apache"


def test_admin_panel_edits_and_fpm_variant():
    files = _files("admin-panel")
    edits = build_version_edits("target-system/admin-panel", "8.4.27", files)
    assert [e["content"] for e in edits] == [files[e["path"]].replace("8.4.20", "8.4.27") for e in edits]
    assert image_variant(files["target-system/admin-panel/Dockerfile"]) == "-fpm"


def test_literal_from_line_and_caret_are_kept():
    assert bump_dockerfile("FROM php:8.1.2-apache\n", "8.2.35") == "FROM php:8.2.35-apache\n"
    assert '"php": "~8.2.35"' in bump_composer('{"require": {"php": "~8.1.2"}}', "8.2.35")


def test_pr_paths_stay_inside_the_service_folder():
    root = allowed_root("target-system/shop/Dockerfile", "shop")
    assert root == "target-system/shop"
    assert check_path("/target-system/shop/composer.json", root) == "target-system/shop/composer.json"
    for bad in ("target-system/shop/../admin-panel/Dockerfile", "target-system/shopping/Dockerfile", "/etc/passwd"):
        with pytest.raises(ValueError):
            check_path(bad, root)


def test_edits_must_pin_the_target_version():
    with pytest.raises(ValueError):
        validate_edit("target-system/shop/Dockerfile", "ARG PHP_VERSION=8.3.35\n", "8.3.36")
    with pytest.raises(ValueError):
        validate_edit("target-system/shop/composer.json", '{"config": {"platform": {"php": "8.3.30"}}}', "8.3.36")


def test_target_is_the_branch_fix_or_the_nearest_supported_branch(facts):
    assert plan_target("8.3.30", facts)[:2] == ("8.3.36", False)
    assert plan_target("8.4.20", facts)[:2] == ("8.4.27", False)
    assert plan_target("8.1.2", facts)[:2] == ("8.2.35", True)
