"""Demo reset: back to 'No system connected' with the vulnerable shop. Used by POST /demo/reset and
scripts/reset.sh (python -m sentinel.reset [--clear-intel])."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from typing import Any

from . import db, history, narrate
from .tools import docker_ops, github_ops


def _github_cleanup() -> dict[str, Any]:
    """Close Guard's open PRs and put the target files on main back to the vulnerable baseline."""
    result: dict[str, Any] = {}
    for key, step in (("prs", github_ops.close_sentinel_prs), ("baseline", github_ops.restore_baseline)):
        try:
            result[key] = step()
        except Exception as exc:
            result[key] = {"error": str(exc)[:300]}
    return result


def reset_demo(clear_intel: bool = False) -> dict[str, Any]:
    """Disconnect: archive the run to history/, then back to the connect form with the vulnerable shop."""
    started = time.monotonic()
    archived = history.archive_current("disconnected")
    db.reset_tables(clear_services=True, clear_intel=clear_intel)
    target = docker_ops.reset_target()
    return {
        "archived": archived,
        "cleared": ["cve_events", "incidents", "agent_runs", "agent_log", "chat_messages", "services"]
        + (["threat_intel"] if clear_intel else []),
        "threat_intel_kept": not clear_intel,
        "target": target,
        "github": _github_cleanup(),
        "seconds": round(time.monotonic() - started, 1),
    }


def new_run() -> dict[str, Any]:
    """New run: archive the run, reset the feed and the target, keep the project connected."""
    started = time.monotonic()
    archived = history.archive_current("new run")
    db.reset_tables(clear_services=False)
    target = docker_ops.reset_target()
    github = _github_cleanup()
    history.start_run()
    narrate.new_run([s["name"] for s in db.load_services()])
    return {"archived": archived, "target": target, "github": github, "seconds": round(time.monotonic() - started, 1)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the Guard demo to its baseline.")
    parser.add_argument("--clear-intel", action="store_true", help="also drop the threat_intel cache")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    result = reset_demo(clear_intel=args.clear_intel)
    print(json.dumps(result, indent=2, default=str))
    db.close_pool()
    sys.exit(0 if result["target"].get("edge_healthy") else 1)


if __name__ == "__main__":
    main()
