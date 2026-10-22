"""GitHub: read the service's files and open the fix PR. Path-restricted to the service's folder,
idempotent per branch, never merges."""

from __future__ import annotations

import json
import logging
import posixpath
import re
from typing import Any

from ..config import REPO_ROOT, get_settings

log = logging.getLogger("sentinel.github")

BRANCH_PREFIX = "sentinel/"
NOT_CONFIGURED = "skipped: GitHub not configured (GITHUB_TOKEN / GITHUB_REPO unset)"
_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
_ARG_RE = re.compile(r"(?m)^(ARG\s+PHP_VERSION=)(\S+)")
_FROM_RE = re.compile(r"(?m)^(FROM\s+php:)(\$\{PHP_VERSION\}|\d+\.\d+\.\d+)(-[\w.-]+)?")


class GitHubNotConfigured(RuntimeError):
    pass


def _repo():
    from github import Auth, Github

    settings = get_settings()
    if not settings.github_enabled:
        raise GitHubNotConfigured(NOT_CONFIGURED)
    client = Github(auth=Auth.Token(settings.github_token), timeout=20, retry=3, seconds_between_writes=0.3)
    return client.get_repo(settings.github_repo)


def allowed_root(repo_path: str | None, service_name: str) -> str:
    """The PR path allowlist: the folder of the service's Dockerfile (label sentinel.repo_path)."""
    if repo_path:
        root = posixpath.dirname(posixpath.normpath(repo_path.lstrip("/")))
        if root and root != ".":
            return root
    return f"target-system/{service_name}"


def check_path(path: str, root: str) -> str:
    normalized = posixpath.normpath(path.strip().lstrip("/"))
    if normalized.startswith("..") or not (normalized == root or normalized.startswith(root + "/")):
        raise ValueError(f"path {path!r} is outside the allowed folder {root}/")
    return normalized


# --- reading ------------------------------------------------------------------------------------


def read_repo_file(path: str) -> dict[str, Any]:
    """Read a file under target-system/ from the GitHub default branch (local working tree when GitHub
    is not configured or the file is not pushed yet)."""
    normalized = check_path(path, "target-system")
    note = None
    if get_settings().github_enabled:
        try:
            repo = _repo()
            content = repo.get_contents(normalized, ref=repo.default_branch)
            return {
                "path": normalized,
                "content": content.decoded_content.decode("utf-8"),
                "source": f"github:{repo.full_name}@{repo.default_branch}",
            }
        except Exception as exc:  # 404 when the repo is not pushed yet, network errors
            note = f"GitHub read failed ({str(exc)[:160]}), using the local working tree"
    local = REPO_ROOT / normalized
    if not local.is_file():
        return {"path": normalized, "error": f"{normalized} not found", **({"note": note} if note else {})}
    result = {"path": normalized, "content": local.read_text(), "source": "local working tree"}
    if note:
        result["note"] = note
    return result


# --- deterministic edits ------------------------------------------------------------------------


def image_variant(dockerfile: str) -> str:
    """'FROM php:${PHP_VERSION}-apache' -> '-apache'."""
    match = _FROM_RE.search(dockerfile)
    return (match.group(3) or "") if match else ""


def current_version(dockerfile: str) -> str | None:
    match = _ARG_RE.search(dockerfile)
    if match:
        return match.group(2)
    match = _FROM_RE.search(dockerfile)
    return match.group(2) if match and not match.group(2).startswith("$") else None


def bump_dockerfile(content: str, target: str) -> str:
    if _ARG_RE.search(content):
        return _ARG_RE.sub(rf"\g<1>{target}", content)
    return _FROM_RE.sub(lambda m: f"{m.group(1)}{target}{m.group(3) or ''}", content)


def bump_composer(content: str, target: str) -> str:
    data = json.loads(content)
    require = data.get("require")
    if isinstance(require, dict) and "php" in require:
        operator = re.match(r"^\s*([\^~]|>=|=)?", str(require["php"])).group(1) or ""
        require["php"] = f"{operator}{target}"
    platform = data.setdefault("config", {}).setdefault("platform", {})
    platform["php"] = target
    return json.dumps(data, indent=4, ensure_ascii=False) + "\n"


def build_version_edits(root: str, target: str, files: dict[str, str]) -> list[dict[str, str]]:
    """Edits for {root}/Dockerfile (ARG PHP_VERSION) and {root}/composer.json (require.php, config.platform.php)."""
    edits = []
    dockerfile = files.get(f"{root}/Dockerfile")
    if dockerfile is not None:
        new = bump_dockerfile(dockerfile, target)
        if new != dockerfile:
            edits.append({"path": f"{root}/Dockerfile", "content": new})
    composer = files.get(f"{root}/composer.json")
    if composer is not None:
        new = bump_composer(composer, target)
        if new != composer:
            edits.append({"path": f"{root}/composer.json", "content": new})
    return edits


def validate_edit(path: str, content: str, target: str) -> None:
    if not content.strip() or len(content) > 100_000:
        raise ValueError(f"{path}: empty or oversized content")
    name = posixpath.basename(path)
    if name == "Dockerfile" and current_version(content) != target:
        raise ValueError(f"{path}: must pin PHP {target} (ARG PHP_VERSION={target})")
    if name == "composer.json":
        data = json.loads(content)
        platform = (data.get("config") or {}).get("platform") or {}
        if platform.get("php") not in (None, target) or target not in str((data.get("require") or {}).get("php", target)):
            raise ValueError(f"{path}: require.php and config.platform.php must target {target}")


# --- pull requests ------------------------------------------------------------------------------


def open_fix_pr(
    *,
    service_name: str,
    repo_path: str | None,
    target_version: str,
    edits: list[dict[str, str]],
    title: str,
    body: str,
    branch: str,
) -> dict[str, Any]:
    """Commit the edits on `branch` (one commit) and open the PR, or update the PR already open for it."""
    if not _VERSION_RE.match(target_version):
        raise ValueError(f"target_version must look like 8.3.36, got {target_version!r}")
    if not branch.startswith(BRANCH_PREFIX):
        raise ValueError(f"branch must start with {BRANCH_PREFIX}")
    root = allowed_root(repo_path, service_name)
    if not edits:
        raise ValueError("no file edits")
    checked = []
    for edit in edits:
        path = check_path(edit["path"], root)
        validate_edit(path, edit["content"], target_version)
        checked.append({"path": path, "content": edit["content"]})
    files = [e["path"] for e in checked]
    if not get_settings().github_enabled:
        return {"ok": False, "skipped": True, "reason": NOT_CONFIGURED, "branch": branch, "files_changed": files}

    from github import GithubException, InputGitTreeElement

    repo = _repo()
    base = repo.default_branch
    base_sha = repo.get_git_ref(f"heads/{base}").object.sha
    owner = repo.owner.login
    existing = next(iter(repo.get_pulls(state="open", head=f"{owner}:{branch}")), None)

    try:
        ref = repo.get_git_ref(f"heads/{branch}")
        if existing is None:
            ref.edit(base_sha, force=True)
        parent_sha = ref.object.sha if existing is not None else base_sha
    except GithubException as exc:
        if exc.status != 404:
            raise
        ref = repo.create_git_ref(ref=f"refs/heads/{branch}", sha=base_sha)
        parent_sha = base_sha

    changed = []
    for edit in checked:
        try:
            current = repo.get_contents(edit["path"], ref=parent_sha).decoded_content.decode("utf-8")
        except GithubException as exc:
            if exc.status == 404:
                raise ValueError(f"{edit['path']} is not on {repo.full_name}@{base}: push the repo first") from exc
            raise
        if current != edit["content"]:
            changed.append(edit)
    if changed:
        parent = repo.get_git_commit(parent_sha)
        tree = repo.create_git_tree(
            [InputGitTreeElement(path=e["path"], mode="100644", type="blob", content=e["content"]) for e in changed],
            base_tree=parent.tree,
        )
        commit = repo.create_git_commit(title, tree, [parent])
        ref.edit(commit.sha)

    if existing is not None:
        existing.edit(title=title, body=body)
        pr = existing
    else:
        if not changed:
            return {"ok": False, "branch": branch, "files_changed": [],
                    "reason": f"{', '.join(files)} already pin PHP {target_version} on {base}: nothing to change"}
        pr = repo.create_pull(base=base, head=branch, title=title, body=body)
        try:
            pr.add_to_labels("security", "sentinel")
        except GithubException:
            pass
    return {"ok": True, "pr_url": pr.html_url, "number": pr.number, "branch": branch,
            "files_changed": files, "reused": existing is not None}


def close_sentinel_prs() -> dict[str, Any]:
    """Demo reset: close open PRs from sentinel/* branches and delete those branches."""
    if not get_settings().github_enabled:
        return {"skipped": True, "reason": NOT_CONFIGURED}
    repo = _repo()
    closed, deleted = [], []
    for pr in repo.get_pulls(state="open"):
        if pr.head.ref.startswith(BRANCH_PREFIX) and pr.head.repo and pr.head.repo.full_name == repo.full_name:
            pr.edit(state="closed")
            closed.append(pr.number)
    for ref in repo.get_git_matching_refs(f"heads/{BRANCH_PREFIX}"):
        ref.delete()
        deleted.append(ref.ref.removeprefix("refs/heads/"))
    return {"closed_prs": closed, "deleted_branches": deleted}
