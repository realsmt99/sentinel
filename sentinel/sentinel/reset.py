"""Demo reset: back to 'No system connected' with the vulnerable shop. Used by POST /demo/reset and
scripts/reset.sh (python -m sentinel.reset [--clear-intel])."""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from typing import Any

from . import db
from .tools import docker_ops, github_ops


def reset_demo(clear_intel: bool = False) -> dict[str, Any]:
    started = time.monotonic()
    db.reset_tables(clear_services=True, clear_intel=clear_intel)
    target = docker_ops.reset_target()
    try:
        github = github_ops.close_sentinel_prs()
    except Exception as exc:
        github = {"error": str(exc)[:300]}
    return {
        "cleared": ["cve_events", "incidents", "agent_runs", "agent_log", "services"] + (["threat_intel"] if clear_intel else []),
        "threat_intel_kept": not clear_intel,
        "target": target,
        "github": github,
        "seconds": round(time.monotonic() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Reset the Sentinel demo to its baseline.")
    parser.add_argument("--clear-intel", action="store_true", help="also drop the threat_intel cache")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    result = reset_demo(clear_intel=args.clear_intel)
    print(json.dumps(result, indent=2, default=str))
    db.close_pool()
    sys.exit(0 if result["target"].get("edge_healthy") else 1)


if __name__ == "__main__":
    main()
