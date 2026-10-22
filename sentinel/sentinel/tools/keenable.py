"""Keenable live web intelligence: the MCP server (search_web_pages, fetch_page_content) for the agents,
and function tools with the same names over the REST API when the MCP connection fails."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

import httpx
from agents import FunctionTool, function_tool
from agents.mcp import MCPServerStreamableHttp, create_static_tool_filter

from ..config import get_settings

log = logging.getLogger("sentinel.keenable")

KEENABLE_TOOLS = ("search_web_pages", "fetch_page_content")
_REST_FETCH_LIMIT = 12_000


def _auth_headers() -> dict[str, str]:
    key = get_settings().keenable_api_key
    return {"X-API-Key": key} if key else {"X-Keenable-Title": "Sentinel"}


def keenable_mcp_server() -> MCPServerStreamableHttp:
    settings = get_settings()
    headers = {"X-API-Key": settings.keenable_api_key} if settings.keenable_api_key else {}
    return MCPServerStreamableHttp(
        name="keenable",
        params={"url": settings.keenable_mcp_url, "headers": headers, "timeout": 30, "sse_read_timeout": 180},
        cache_tools_list=True,
        client_session_timeout_seconds=120,
        max_retry_attempts=2,
        tool_filter=create_static_tool_filter(allowed_tool_names=list(KEENABLE_TOOLS)),
    )


@asynccontextmanager
async def keenable_session() -> AsyncIterator[MCPServerStreamableHttp | None]:
    """A connected Keenable MCP server, or None when it cannot be reached (agents then use REST tools).
    Enter and exit in the same task: the MCP transport uses anyio cancel scopes."""
    server = keenable_mcp_server()
    connected = False
    try:
        async with asyncio.timeout(25):
            await server.connect()
            names = {tool.name for tool in await server.list_tools()}
        missing = set(KEENABLE_TOOLS) - names
        if missing:
            raise RuntimeError(f"Keenable MCP does not expose {sorted(missing)}")
        connected = True
    except Exception as exc:
        log.warning("Keenable MCP unavailable (%s), falling back to the REST API", exc)
    try:
        yield server if connected else None
    finally:
        with suppress(Exception):
            await server.cleanup()


async def rest_search(query: str, site: str | None = None, published_after: str | None = None,
                      max_results: int = 6) -> str:
    settings = get_settings()
    path = "/v1/search" if settings.keenable_api_key else "/v1/search/public"
    body: dict[str, Any] = {"query": query, "max_results": max_results}
    if site:
        body["site"] = site
    if published_after:
        body["published_after"] = published_after
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.post(settings.keenable_api_url + path, json=body, headers=_auth_headers())
        if response.status_code in (400, 422) and len(body) > 2:
            response = await client.post(settings.keenable_api_url + path, json={"query": query, "max_results": max_results},
                                         headers=_auth_headers())
        response.raise_for_status()
    results = response.json().get("results", [])
    if not results:
        return "No results."
    return "\n\n---\n\n".join(
        f"Title: {r.get('title', '')}\nURL: {r.get('url', '')}\nPublished: {(r.get('published_at') or '')[:10]}\n"
        f"Snippet: {(r.get('snippet') or r.get('description') or '').strip()[:1200]}"
        for r in results
    )


async def rest_fetch(url: str, max_chars: int = _REST_FETCH_LIMIT) -> str:
    settings = get_settings()
    path = "/v1/fetch" if settings.keenable_api_key else "/v1/fetch/public"
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.get(settings.keenable_api_url + path, params={"url": url}, headers=_auth_headers())
        response.raise_for_status()
    data = response.json()
    content = (data.get("content") or "").strip()
    if len(content) > max_chars:
        content = content[:max_chars] + "\n[truncated]"
    return f"Title: {data.get('title', '')}\nURL: {data.get('url', url)}\n\n{content}"


def keenable_rest_tools() -> list[FunctionTool]:
    """Function tools named like the MCP tools, so agent instructions and dashboard lines do not change."""

    @function_tool(name_override="search_web_pages")
    async def search_web_pages(query: str, site: str | None = None, published_after: str | None = None) -> str:
        """Search the live web with Keenable. Describe the ideal page rather than keywords.

        Args:
            query: Natural language description of the page you want.
            site: Restrict results to one site, e.g. "php.net".
            published_after: Only pages published after this date (YYYY-MM-DD).
        """
        return await rest_search(query, site, published_after)

    @function_tool(name_override="fetch_page_content")
    async def fetch_page_content(url: str, prompt: str | None = None) -> str:
        """Fetch a web page as clean text (truncated to 12000 characters).

        Args:
            url: The page URL.
            prompt: What you are looking for on the page (used to keep notes focused).
        """
        return await rest_fetch(url)

    return [search_web_pages, fetch_page_content]
