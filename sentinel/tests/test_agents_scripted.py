"""Opt-in integration test: the real orchestrator, agents, tools and dashboard hooks, driven by the SDK's
ScriptedModel instead of OpenAI (no key needed; Keenable is called keyless). Needs a throwaway Postgres 15+
and the running target system; it takes the shop offline and resets the demo baseline afterwards.

    SENTINEL_IT_DATABASE_URL=postgresql://postgres:test@localhost:55432/postgres uv run pytest tests/test_agents_scripted.py
"""

from __future__ import annotations

import asyncio
import json
import os
import re

import psycopg
import pytest

IT_DATABASE_URL = os.getenv("SENTINEL_IT_DATABASE_URL")
pytestmark = pytest.mark.skipif(not IT_DATABASE_URL, reason="set SENTINEL_IT_DATABASE_URL to run")

TARGETS = {"shop": ("8.3.36", "-apache"), "admin-panel": ("8.4.27", "-fpm")}


def _items(call) -> list[dict]:
    items = call.input if isinstance(call.input, list) else [{"role": "user", "content": call.input}]
    return [item if isinstance(item, dict) else item.model_dump() for item in items]


def _user_text(call) -> str:
    for item in _items(call):
        if item.get("role") == "user":
            content = item.get("content")
            return content if isinstance(content, str) else json.dumps(content)
    return ""


def _outputs(call) -> list[tuple[str, str]]:
    names, outputs = {}, []
    for item in _items(call):
        if item.get("type") == "function_call":
            names[item["call_id"]] = item["name"]
        elif item.get("type") == "function_call_output":
            outputs.append((names.get(item["call_id"], "?"), str(item.get("output"))))
    return outputs


def _service(call) -> str:
    return re.search(r"Service: ([\w-]+)", _user_text(call)).group(1)


def responder(intel_fixture: dict):
    from agents.testing import assistant_message, function_call

    from sentinel.tools.github_ops import build_version_edits

    def final(obj: dict):
        return [assistant_message(json.dumps(obj))]

    def respond(call):
        prompt = call.system_instructions or ""
        done = _outputs(call)
        n = len(done)
        if prompt.startswith("You are the Triage agent"):
            cves = json.loads(_user_text(call))["cves"]
            return final({"verdicts": [
                {"cve_id": c["cve_id"], "is_runtime_vuln": False, "product": "a PHP web application",
                 "reason": "affects a PHP web application, not in our inventory"} for c in cves]})
        if prompt.startswith("You are the Threat Intel agent"):
            if n == 0:
                return [function_call("get_nvd_ranges", {"cve_id": "CVE-2026-109618"}, call_id="nvd1"),
                        function_call("search_web_pages", {"query": "PHP 8.3.36 security release announcement",
                                                           "published_after": "2026-10-20"}, call_id="s1")]
            if n == 2:
                return [function_call("fetch_page_content", {"url": "https://www.php.net/archive/2026.php",
                                                             "max_chars": 2000,
                                                             "prompt": "fixed versions per branch"}, call_id="f1")]
            data = dict(intel_fixture, summary="Scripted research run.")
            data["fixed_versions"] = [{"branch": b, **e} for b, e in intel_fixture["fixed_versions"].items()]
            return final(data)
        if prompt.startswith("You are a Risk Scoring agent"):
            name = _service(call)
            if n == 0:
                return [function_call("compute_danger_score", {"name": name}, call_id=f"score-{name}")]
            result = json.loads(done[-1][1])
            return final({"service": name, "score": result["score"], "band": result["band"],
                          "explanation": f"Scripted explanation for {name}: {result['band']}."})
        if prompt.startswith("You are the Containment agent"):
            name = _service(call)
            if n == 0:
                return [function_call("take_offline", {"name": name}, call_id="off")]
            if n == 1:
                return [function_call("send_alert", {"title": f"Sentinel: {name} taken offline (PHP2Shell)",
                                                     "message": "Score 92.", "priority": "urgent",
                                                     "click_url": "http://localhost:3000"}, call_id="alert")]
            return final({"service": name, "offline": True, "alert_sent": False, "message": "Taken offline."})
        if prompt.startswith("You are a Remediation agent"):
            name = _service(call)
            target, variant = TARGETS[name]
            root = f"target-system/{name}"
            if n == 0:
                return [function_call("check_docker_tag", {"repository": "php", "tag": target + variant}, call_id="tag"),
                        function_call("read_repo_file", {"path": f"{root}/Dockerfile"}, call_id="r1"),
                        function_call("read_repo_file", {"path": f"{root}/composer.json"}, call_id="r2")]
            if n == 3:
                files = {}
                for tool, output in done:
                    if tool == "read_repo_file":
                        data = json.loads(output)
                        files[data["path"]] = data["content"]
                edits = build_version_edits(root, target, files)
                return [function_call("open_fix_pr", {"service": name, "target_version": target, "edits": edits,
                                                      "title": f"Sentinel: bump {name} to PHP {target} (PHP2Shell)",
                                                      "body": "Scripted PR body."}, call_id="pr")]
            pr = json.loads(done[-1][1])
            return final({"service": name, "target_version": target, "fix_verified": True,
                          "docker_tag_verified": True, "files_changed": pr.get("files_changed", []),
                          "pr_url": pr.get("pr_url"), "notes": pr.get("reason") or "PR opened"})
        raise AssertionError(f"unexpected agent: {prompt[:60]}")

    return respond


def test_agent_team_with_scripted_model(monkeypatch):
    for key, value in {"DATABASE_URL": IT_DATABASE_URL, "OPENAI_API_KEY": "sk-scripted-test", "GITHUB_TOKEN": "",
                       "GITHUB_REPO": "", "NTFY_TOPIC": "", "INTEL_OFFLINE": "", "KEENABLE_API_KEY": ""}.items():
        monkeypatch.setenv(key, value)

    from agents import RunConfig, set_tracing_disabled
    from agents.testing import ModelStep, ScriptedModel

    from sentinel import db, feed, orchestrator, scanner
    from sentinel.config import SCHEMA_SQL, get_settings
    from sentinel.reset import reset_demo
    from sentinel.tools import docker_ops, risk

    get_settings.cache_clear()
    db.close_pool()
    set_tracing_disabled(True)
    with psycopg.connect(IT_DATABASE_URL, autocommit=True) as conn:
        conn.execute(SCHEMA_SQL.read_text())

    model = ScriptedModel([ModelStep.respond(responder(risk.load_intel_fixture())) for _ in range(80)])
    real_run = orchestrator.Runner.run

    async def scripted_run(agent, prompt, **kwargs):
        return await real_run(agent, prompt, run_config=RunConfig(model=model, tracing_disabled=True), **kwargs)

    monkeypatch.setattr(orchestrator.Runner, "run", scripted_run)
    try:
        assert len(scanner.scan()) == 3
        with db.connection() as conn:
            db.insert_cve_chunk(conn, feed.load_fixture())
        orchestrator.catch_up_stage1()
        asyncio.run(orchestrator.handle_feed_done())

        funnel = db.feed_funnel()
        assert (funnel["total"], funnel["keyword_hits"], funnel["matched"], funnel["candidates"]) == (544, 40, 2, 0)

        lanes = {(r["agent"], r["service"]): r for r in db.query("SELECT * FROM agent_runs")}
        expected = {("triage", None), ("threat_intel", None), ("risk_scoring", "shop"), ("risk_scoring", "admin-panel"),
                    ("risk_scoring", "billing-worker"), ("containment", "shop"), ("remediation", "shop"),
                    ("remediation", "admin-panel")}
        assert set(lanes) == expected
        assert {k: v["status"] for k, v in lanes.items()} == {k: "done" for k in expected}, \
            {k: (v["status"], v["error"]) for k, v in lanes.items()}
        assert lanes[("threat_intel", None)]["output"]["fixed_versions"]["8.3"]["version"] == "8.3.36"

        incidents = {i["service"]: i for i in db.incidents_for("php")}
        assert (incidents["shop"]["danger_score"], incidents["shop"]["band"], incidents["shop"]["status"]) == (92, "TAKE_OFFLINE", "MITIGATED")
        assert (incidents["admin-panel"]["danger_score"], incidents["admin-panel"]["band"]) == (67, "PR_ONLY")
        assert (incidents["billing-worker"]["danger_score"], incidents["billing-worker"]["band"]) == (0, "NONE")
        assert incidents["shop"]["explanation"].startswith("Scripted explanation")
        assert incidents["admin-panel"]["remediation"]["target_version"] == "8.4.27"
        assert incidents["shop"]["remediation"]["pr_skipped_reason"].startswith("skipped: GitHub not configured")

        log = "\n".join(r["message"] for r in db.query("SELECT message FROM agent_log ORDER BY id"))
        if os.getenv("SENTINEL_IT_VERBOSE"):
            print("\n" + log)
        for line in ("Threat Intel -> get_nvd_ranges(CVE-2026-109618)",
                     "Threat Intel -> fetch_page_content(php.net/archive/2026.php)",
                     "Risk Scoring [shop] -> compute_danger_score(shop)",
                     "Containment [shop] -> take_offline(shop)",
                     "Remediation [shop] -> check_docker_tag(php:8.3.36-apache)",
                     "Remediation [admin-panel] -> open_fix_pr(admin-panel -> PHP 8.4.27)"):
            assert line in log
        assert docker_ops.flag_path("shop").exists()
        assert not docker_ops.container_running("shop")
        assert db.latest_intel("php")["data"]["summary"] == "Scripted research run."
    finally:
        reset_demo()
        db.close_pool()
        get_settings.cache_clear()
