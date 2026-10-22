"""Remediation agent (smart model, one run per affected service): verifies the official fix and the Docker
tag, edits Dockerfile + composer.json and opens the PR. remediate_in_code is its deterministic fallback."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from agents import Agent, RunContextWrapper, function_tool
from pydantic import BaseModel

from .. import db
from ..config import get_settings
from ..scoring import AdvisoryFacts, assess_version
from ..tools import dockerhub, github_ops
from ..tools.keenable import keenable_rest_tools
from ..tools.nvd import branch_key, branch_of
from ..triage import runtime_name
from .common import AdvisoryContext, model_settings
from .models import RemediationResult

INSTRUCTIONS = """You are a Remediation agent of Guard, the security team of a small online coffee roaster.
You prepare the fix for one service and open a pull request. You never merge anything.

Steps:
1. Target version: the official fixed release on the service's installed major.minor branch (the facts
   you are given list them). If that branch has no official fix, target the fixed release of the nearest
   newer supported branch: that is a breaking change that needs review.
2. Verify the release with at most two web calls: search_web_pages for the official announcement of that
   PHP version (php.net or the PHP mailing lists); optionally fetch_page_content with max_chars <= 4000
   and a prompt.
3. check_docker_tag("php", "<target><variant>"), where <variant> is the suffix of the Dockerfile FROM line
   (for example -apache or -fpm). If the tag does not exist, do not open a PR and explain why in notes.
4. read_repo_file for the service's Dockerfile and composer.json, then call open_fix_pr once with the full
   new content of both files. Change only the version: Dockerfile "ARG PHP_VERSION=<target>";
   composer.json require.php "^<target>" and config.platform.php "<target>"; keep everything else
   byte-for-byte. Title: "Guard: bump <service> to PHP <target> (<advisory>)", prefixed with
   "[breaking change, needs review] " for a branch upgrade. Body in Markdown: danger score and band, why,
   the changes, verification (release link, Docker tag), sources, and "Opened by Guard, never auto-merged".
5. Return a RemediationResult. pr_url is the URL open_fix_pr returned, or null when it was skipped
   (for example GitHub not configured); say so in notes."""


class FileEdit(BaseModel):
    path: str
    content: str


@function_tool
async def check_docker_tag(ctx: RunContextWrapper[AdvisoryContext], repository: str, tag: str) -> str:
    """Check on Docker Hub that an image tag exists.

    Args:
        repository: Image repository, e.g. php.
        tag: Image tag, e.g. 8.3.36-apache.
    """
    result = await asyncio.to_thread(dockerhub.check_docker_tag, repository, tag)
    ctx.context.tag_checks.append(result)
    return json.dumps(result)


@function_tool
async def read_repo_file(path: str) -> str:
    """Read a file of the company repository (under target-system/).

    Args:
        path: Repository path, e.g. target-system/shop/Dockerfile.
    """
    try:
        return json.dumps(await asyncio.to_thread(github_ops.read_repo_file, path))
    except ValueError as exc:
        return json.dumps({"error": str(exc)})


async def submit_fix_pr(
    run: AdvisoryContext,
    service_name: str,
    target_version: str,
    edits: list[dict[str, str]],
    title: str,
    body: str,
) -> dict[str, Any]:
    """Gate + open the PR: the target must leave the affected range and its Docker tag must exist."""
    service = await asyncio.to_thread(db.get_service, service_name)
    if not service:
        return {"ok": False, "error": f"unknown service {service_name!r}"}
    if run.facts and assess_version(target_version, run.facts).affected:
        return {"ok": False, "refused": True, "reason": f"PHP {target_version} is still affected by {', '.join(run.cve_ids)}"}
    dockerfile = next((e["content"] for e in edits if e["path"].endswith("Dockerfile")), "")
    tag = await asyncio.to_thread(dockerhub.check_docker_tag, "php", f"{target_version}{github_ops.image_variant(dockerfile)}")
    if tag.get("exists") is False:
        return {"ok": False, "refused": True, "reason": f"Docker image {tag['image']} does not exist"}
    try:
        result = await asyncio.to_thread(
            github_ops.open_fix_pr,
            service_name=service_name,
            repo_path=service.get("repo_path"),
            target_version=target_version,
            edits=edits,
            title=title,
            body=body,
            branch=f"guard/{run.slug}-{service_name}",
        )
    except Exception as exc:  # validation errors and GitHub API errors go back to the model
        result = {"ok": False, "error": str(exc)[:300]}
    run.pr_results.append({**result, "target_version": target_version, "title": title})
    if result.get("pr_url"):
        incident = await asyncio.to_thread(db.get_incident, run.component, service_name)
        if incident:
            await asyncio.to_thread(db.update_incident, incident["id"], pr_url=result["pr_url"])
    return result


@function_tool
async def open_fix_pr(
    ctx: RunContextWrapper[AdvisoryContext],
    service: str,
    target_version: str,
    edits: list[FileEdit],
    title: str,
    body: str,
) -> str:
    """Open (or update) the fix pull request for one service. Only files in the service's folder are
    accepted; the target version must be fixed and its Docker tag must exist. Never merges.

    Args:
        service: The service name, e.g. shop.
        target_version: The PHP version to move to, e.g. 8.3.36.
        edits: Full new content of each changed file (path + content).
        title: Pull request title.
        body: Pull request body in Markdown.
    """
    run = ctx.context
    if run.service and service != run.service:
        return json.dumps({"ok": False, "refused": True, "reason": f"this lane fixes {run.service} only"})
    result = await submit_fix_pr(run, service, target_version, [e.model_dump() for e in edits], title, body)
    return json.dumps(result)


def build_remediation_agent(keenable: Any | None) -> Agent:
    model = get_settings().model_smart
    tools: list[Any] = [check_docker_tag, read_repo_file, open_fix_pr]
    if keenable is None:
        tools.extend(keenable_rest_tools())
    return Agent(
        name="Remediation",
        instructions=INSTRUCTIONS,
        model=model,
        model_settings=model_settings(model),
        tools=tools,
        mcp_servers=[keenable] if keenable is not None else [],
        output_type=RemediationResult,
    )


def plan_target(version: str | None, facts: AdvisoryFacts) -> tuple[str | None, bool, str]:
    """(target_version, breaking, why): the branch's official fix, else the nearest newer supported branch."""
    if not version:
        return None, False, "installed version unknown"
    verdict = assess_version(version, facts)
    if verdict.fixed_version:
        return verdict.fixed_version, False, f"official fix on the {verdict.branch} branch"
    branch = verdict.branch or branch_of(version)
    newer = sorted((b for b in facts.fixed_versions if branch_key(b) > branch_key(branch)), key=branch_key)
    if newer:
        return facts.fixed_versions[newer[0]], True, (
            f"no official fix for {branch}: upgrade to the nearest supported branch {newer[0]} (breaking change)"
        )
    return None, False, f"no fixed release known for {branch}"


def remediation_input(run: AdvisoryContext, service: dict[str, Any], incident: dict[str, Any]) -> str:
    root = github_ops.allowed_root(service.get("repo_path"), service["name"])
    fixed = {b: v for b, v in (run.facts.fixed_versions.items() if run.facts else [])}
    return (
        f"Service: {service['name']}, {runtime_name(service['language'])} {service.get('runtime_version')} "
        f"({service.get('runtime_mode')}, {service['exposure']}), image {service.get('image')}.\n"
        f"Files: {root}/Dockerfile and {root}/composer.json (open_fix_pr only accepts files under {root}/).\n"
        f"Advisory: {run.title} ({', '.join(run.cve_ids)}), short name for titles: {run.short_name}.\n"
        f"Danger score {incident['danger_score']} ({incident['band']}). {incident.get('explanation') or ''}\n"
        f"Official fixed releases per branch (Threat Intel): {json.dumps(fixed)}; oldest supported branch: "
        f"{run.facts.min_supported_branch if run.facts else 'unknown'}.\n"
        f"Release sources: {json.dumps({b: e.get('source_url') for b, e in (run.intel.get('fixed_versions') or {}).items()})}"
    )


def pr_text(run: AdvisoryContext, service: dict[str, Any], incident: dict[str, Any], target: str, breaking: bool,
            tag: dict[str, Any], files: list[str], why: str) -> tuple[str, str]:
    name = service["name"]
    title = f"{'[breaking change, needs review] ' if breaking else ''}Guard: bump {name} to PHP {target} ({run.short_name})"
    source = ((run.intel.get("fixed_versions") or {}).get(branch_of(target)) or {}).get("source_url")
    lines = [
        f"## {run.short_name}: fix for `{name}`",
        "",
        f"**Danger score {incident['danger_score']}/100 ({incident['band']})**. {incident.get('explanation') or ''}",
        "",
        f"Bumps PHP from {service.get('runtime_version')} to **{target}** ({why}), fixing {', '.join(run.cve_ids)}.",
    ]
    if breaking:
        lines += ["", "> **Breaking change, needs review:** this moves to a newer PHP branch; test the application first."]
    lines += ["", "### Changes"]
    for path in files:
        if path.endswith("Dockerfile"):
            lines.append(f"- `{path}`: `ARG PHP_VERSION={target}`")
        elif path.endswith("composer.json"):
            lines.append(f"- `{path}`: `require.php` ^{target}, `config.platform.php` {target}")
        else:
            lines.append(f"- `{path}`")
    lines += ["", "### Verification"]
    if source:
        lines.append(f"- Official release: {source}")
    if tag.get("exists"):
        lines.append(f"- Docker image `{tag['image']}` exists on Docker Hub")
    sources = run.intel.get("sources") or []
    if sources:
        lines += ["", "### Sources"] + [f"- [{s.get('title') or s.get('url')}]({s.get('url')})" for s in sources[:6]]
    lines += ["", "---", "Opened by Guard, never auto-merged: a human reviews, merges and approves the restore."]
    return title, "\n".join(lines)


async def remediate_in_code(run: AdvisoryContext, service: dict[str, Any], incident: dict[str, Any]) -> RemediationResult:
    """The deterministic remediation: same gates and edits as the agent, without the web research."""
    name = service["name"]
    target, breaking, why = plan_target(service.get("runtime_version"), run.facts)
    if not target:
        return RemediationResult(service=name, target_version="", fix_verified=False, docker_tag_verified=False,
                                 files_changed=[], pr_url=None, notes=f"No PR: {why}.")
    root = github_ops.allowed_root(service.get("repo_path"), name)
    files: dict[str, str] = {}
    for filename in ("Dockerfile", "composer.json"):
        read = await asyncio.to_thread(github_ops.read_repo_file, f"{root}/{filename}")
        if read.get("content") is not None:
            files[read["path"]] = read["content"]
    variant = github_ops.image_variant(files.get(f"{root}/Dockerfile", ""))
    tag = await asyncio.to_thread(dockerhub.check_docker_tag, "php", f"{target}{variant}")
    run.tag_checks.append(tag)
    source = ((run.intel.get("fixed_versions") or {}).get(branch_of(target)) or {}).get("source_url")
    edits = github_ops.build_version_edits(root, target, files)
    changed = [e["path"] for e in edits]
    if tag.get("exists") is False:
        return RemediationResult(service=name, target_version=target, fix_verified=bool(source),
                                 docker_tag_verified=False, files_changed=[], pr_url=None,
                                 notes=f"No PR: Docker image {tag['image']} does not exist.")
    title, body = pr_text(run, service, incident, target, breaking, tag, changed, why)
    result = await submit_fix_pr(run, name, target, edits, title, body) if edits else {"ok": False, "reason": "files already pin the target"}
    notes = [why[0].upper() + why[1:] + "."]
    if source:
        notes.append(f"Release per Threat Intel: {source}.")
    if result.get("pr_url"):
        notes.append("PR opened by code (fallback).")
    else:
        notes.append(f"PR not opened: {result.get('reason') or result.get('error') or 'unknown error'}.")
    return RemediationResult(
        service=name,
        target_version=target,
        fix_verified=bool(source),
        docker_tag_verified=bool(tag.get("exists")),
        files_changed=changed,
        pr_url=result.get("pr_url"),
        notes=" ".join(notes),
    )


def advisory_slug(intel: dict[str, Any], component: str, cve_ids: list[str]) -> str:
    title = intel.get("title") or ""
    name = title.split(":", 1)[0] if ":" in title else f"{component}-{cve_ids[0] if cve_ids else 'advisory'}"
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or component
