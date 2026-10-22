"""DashboardHooks: every agent start, tool call and end becomes an agent_runs lane update and an
agent_log line, so the dashboard shows the agent team working live."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from agents import RunHooks
from pydantic import BaseModel

from . import db

log = logging.getLogger("sentinel.hooks")


def lane_label(agent: str, service: str | None) -> str:
    label = db.AGENT_LABELS.get(agent, agent)
    return f"{label} [{service}]" if service else label


def _short_url(url: str) -> str:
    text = url.split("://", 1)[-1].removeprefix("www.")
    return text if len(text) <= 70 else text[:67] + "..."


def format_call(tool: str, raw_args: str | None) -> str:
    """'fetch_page_content(php.net/archive/2026.php)', 'check_docker_tag(php:8.3.36-apache)', ..."""
    try:
        args = json.loads(raw_args) if raw_args else {}
    except (TypeError, ValueError):
        args = {}
    if not isinstance(args, dict):
        args = {}
    if tool == "check_docker_tag" and args.get("tag"):
        arg = f"{args.get('repository', 'php')}:{args['tag']}"
    elif tool == "open_fix_pr" and args.get("target_version"):
        arg = f"{args.get('service', '?')} -> PHP {args['target_version']}"
    elif args.get("url"):
        arg = _short_url(str(args["url"]))
    elif args.get("query"):
        query = str(args["query"])
        arg = '"' + (query if len(query) <= 70 else query[:67] + "...") + '"'
    elif args.get("title"):
        arg = '"' + str(args["title"])[:60] + '"'
    else:
        arg = next((str(v) for v in args.values() if isinstance(v, (str, int, float)) and str(v)), "")
    return f"{tool}({arg})"


def _as_json(result: Any) -> Any:
    if isinstance(result, (dict, list)):
        return result
    try:
        return json.loads(str(result))
    except (TypeError, ValueError):
        return None


def summarize_result(tool: str, result: Any) -> tuple[str, str] | None:
    """One short line about a tool result, with its log level; None to stay quiet."""
    data = _as_json(result)
    text = str(result)
    if isinstance(data, dict) and data.get("error"):
        return f"{tool} error: {str(data['error'])[:160]}", "warn"
    if tool == "compute_danger_score" and isinstance(data, dict):
        return f"score {data.get('score')} {data.get('band')}", "info"
    if tool == "take_offline" and isinstance(data, dict):
        if data.get("refused"):
            return str(data.get("reason")), "warn"
        edge = f", edge returns {data['edge_status']}" if data.get("edge_status") else ""
        return f"{data.get('service')} offline: maintenance page on, container stopped={data.get('container_stopped')}{edge}", "success"
    if tool == "send_alert" and isinstance(data, dict):
        if data.get("sent"):
            return "phone alert sent", "success"
        return str(data.get("reason") or data.get("error") or "alert not sent"), "warn"
    if tool == "check_docker_tag" and isinstance(data, dict):
        exists = data.get("exists")
        return f"{data.get('image')} {'exists' if exists else 'missing' if exists is False else 'unknown'}", "info" if exists else "warn"
    if tool == "open_fix_pr" and isinstance(data, dict):
        if data.get("pr_url"):
            return f"PR {'updated' if data.get('reused') else 'opened'}: {data['pr_url']}", "success"
        return str(data.get("reason") or data.get("error") or "PR not opened"), "warn"
    if tool == "get_nvd_ranges" and isinstance(data, dict):
        fixed = ", ".join((data.get("fixed_by_branch") or {}).values())
        return f"{len(data.get('ranges') or [])} CPE ranges, fixed in {fixed or 'n/a'}", "info"
    if tool == "read_repo_file" and isinstance(data, dict):
        return f"{data.get('path')} ({data.get('source')})", "info"
    if tool == "search_web_pages":
        return f"{text.count('URL:')} results", "info"
    if tool == "fetch_page_content":
        return f"{len(text):,} chars", "info"
    return None


class DashboardHooks(RunHooks[Any]):
    """Run hooks for one lane: (component, agent, service)."""

    def __init__(self, component: str | None, agent: str, service: str | None = None) -> None:
        self.component = component
        self.agent = agent
        self.service = service
        self.label = lane_label(agent, service)
        self.tool_calls: list[str] = []
        self._started = False

    async def _write(self, fn, *args: Any, **kwargs: Any) -> None:
        try:
            await asyncio.to_thread(fn, *args, **kwargs)
        except Exception as exc:  # the dashboard must never break an agent run
            log.warning("dashboard write failed: %s", exc)

    async def log(self, message: str, level: str = "info") -> None:
        await self._write(db.log_line, message, level, component=self.component, agent=self.agent, service=self.service)

    async def on_agent_start(self, context: Any, agent: Any) -> None:
        if self._started:
            return
        self._started = True
        await self._write(db.lane_start, self.component, self.agent, self.service)
        await self.log(f"{self.label} started ({agent.model})")

    async def on_tool_start(self, context: Any, agent: Any, tool: Any) -> None:
        call = format_call(tool.name, getattr(context, "tool_arguments", None))
        self.tool_calls.append(call)
        await self._write(db.lane, self.component, self.agent, self.service, last_tool=call)
        await self.log(f"{self.label} -> {call}")

    async def on_tool_end(self, context: Any, agent: Any, tool: Any, result: Any) -> None:
        summary = summarize_result(tool.name, result)
        if summary:
            await self.log(f"{self.label} <- {tool.name}: {summary[0]}", summary[1])

    async def on_agent_end(self, context: Any, agent: Any, output: Any) -> None:
        data = output.model_dump(mode="json") if isinstance(output, BaseModel) else output
        await self._write(db.lane_finish, self.component, self.agent, self.service, status="done", output=data)
        await self.log(f"{self.label} finished after {len(self.tool_calls)} tool calls")
