"""Local run history. A run starts at Connect (or New run); at every milestone it is snapshotted to
history/<run-id>.json in the same shape as the dashboard state, so any past run can be reopened read-only.
Reset and New run archive the live run before the tables are cleared."""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import db
from .config import REPO_ROOT, get_settings

log = logging.getLogger("sentinel.history")

HISTORY_DIR = REPO_ROOT / "history"
_lock = threading.RLock()

# Mirrors dashboard/lib/server/state.ts (camelCase keys), without its row limits.
_STATE_SQL = """
SELECT json_build_object(
  'dbNow', now(),
  'services', (SELECT coalesce(json_agg(s ORDER BY (s.exposure = 'public') DESC, s.name), '[]')
     FROM (SELECT id, name, container_name, language, runtime_version, runtime_mode, image, exposure,
                  monthly_revenue_eur, repo_path, status, last_seen FROM services) s),
  'funnel', (SELECT row_to_json(f)
     FROM (SELECT ff.*, x.keyword_only, x.triage_dismissed, x.first_received_at, x.last_received_at
             FROM feed_funnel ff
            CROSS JOIN (SELECT count(*) FILTER (WHERE keyword_match AND triage_status <> 'MATCHED')::int AS keyword_only,
                               count(*) FILTER (WHERE keyword_match AND triage_status = 'DISMISSED')::int AS triage_dismissed,
                               min(received_at) AS first_received_at,
                               max(received_at) AS last_received_at
                          FROM cve_events) x) f),
  'matchedCves', (SELECT coalesce(json_agg(c ORDER BY c.id), '[]')
     FROM (SELECT id, cve_id, published, cvss::float8 AS cvss, cvss_version, triage_status, triage_reason,
                  component, received_at, left(description, 400) AS description
             FROM cve_events WHERE triage_status = 'MATCHED') c),
  'keywordCves', (SELECT coalesce(json_agg(c ORDER BY c.id), '[]')
     FROM (SELECT id, cve_id, published, cvss::float8 AS cvss, cvss_version, triage_status, triage_reason,
                  component, received_at, left(description, 240) AS description
             FROM cve_events WHERE keyword_match AND triage_status <> 'MATCHED' ORDER BY id LIMIT 60) c),
  'agentRuns', (SELECT coalesce(json_agg(r ORDER BY r.id), '[]')
     FROM (SELECT id, component, agent, service, status, last_tool, started_at, ended_at, output, error
             FROM agent_runs) r),
  'log', (SELECT coalesce(json_agg(l ORDER BY l.id), '[]')
     FROM (SELECT id, component, agent, service, level, message, ts FROM agent_log) l),
  'incidents', (SELECT coalesce(json_agg(i ORDER BY i.danger_score DESC NULLS LAST, i.id), '[]')
     FROM (SELECT inc.id, inc.component, inc.cve_ids, inc.service_id, s.name AS service, inc.danger_score,
                  inc.score_breakdown, inc.band, inc.explanation, inc.remediation, inc.pr_url, inc.status,
                  inc.created_at, inc.mitigated_at, inc.resolved_at,
                  (SELECT min(c.received_at) FROM cve_events c WHERE c.cve_id = ANY (inc.cve_ids)) AS cve_received_at
             FROM incidents inc JOIN services s ON s.id = inc.service_id) i),
  'threatIntel', (SELECT coalesce(json_agg(t ORDER BY t.component), '[]')
     FROM (SELECT DISTINCT ON (component) id, component, cve_ids, data, fetched_at
             FROM threat_intel ORDER BY component, fetched_at DESC, id DESC) t),
  'alerts', (SELECT coalesce(json_agg(a ORDER BY a.id), '[]')
     FROM (SELECT id, component, agent, service, level, message, ts FROM agent_log
            WHERE message LIKE '%%send_alert%%' OR message LIKE '%%phone alert%%') a),
  'chat', (SELECT coalesce(json_agg(m ORDER BY m.id), '[]')
     FROM (SELECT id, run_id, role, text, card, ts FROM chat_messages WHERE run_id = %(run_id)s) m)
) AS state
"""


def current_run() -> dict | None:
    return db.query_one("SELECT * FROM runs WHERE status = 'live' ORDER BY started_at DESC LIMIT 1")


def start_run(title: str | None = None) -> str:
    """Open a new live run (the caller archives the previous one first)."""
    now = datetime.now()
    run_id = now.strftime("%Y-%m-%dT%H-%M-%S")
    db.execute(
        "INSERT INTO runs (id, title) VALUES (%s, %s) ON CONFLICT (id) DO NOTHING",
        (run_id, title or f"Run {now:%d %b, %H:%M}"),
    )
    save_current()
    return run_id


def ensure_run() -> str:
    run = current_run()
    return run["id"] if run else start_run()


def set_title(title: str) -> None:
    db.execute("UPDATE runs SET title = %s WHERE status = 'live'", (title,))


def _outcome(state: dict[str, Any]) -> str:
    incidents = state.get("incidents") or []
    if any(i.get("status") == "RESOLVED" for i in incidents):
        return "resolved"
    if any(i.get("band") == "TAKE_OFFLINE" for i in incidents):
        return "contained"
    if any(i.get("band") in ("PR_ONLY", "DIGEST") for i in incidents):
        return "patching"
    if (state.get("funnel") or {}).get("total"):
        return "no impact"
    return "connected" if state.get("services") else "empty"


def _summary(state: dict[str, Any], outcome: str) -> dict[str, Any]:
    incidents = state.get("incidents") or []
    top = max(incidents, key=lambda i: i.get("danger_score") or 0, default=None)
    funnel = state.get("funnel") or {}
    return {
        "outcome": outcome,
        "services": [s["name"] for s in state.get("services") or []],
        "cves": funnel.get("total") or 0,
        "matched": funnel.get("matched") or 0,
        "topService": top and top.get("service"),
        "topScore": top and top.get("danger_score"),
        "prs": [i["pr_url"] for i in incidents if i.get("pr_url")],
        "messages": len(state.get("chat") or []),
    }


def _write(run: dict[str, Any], reason: str | None = None) -> Path:
    row = db.query_one(_STATE_SQL, {"run_id": run["id"]})
    state = dict(row["state"]) if row else {}
    state["targetUrl"] = get_settings().target_url
    outcome = _outcome(state)
    doc = {
        "id": run["id"],
        "title": run["title"],
        "status": run["status"],
        "outcome": outcome,
        "endReason": reason,
        "startedAt": run["started_at"].isoformat(),
        "endedAt": run["ended_at"].isoformat() if run.get("ended_at") else None,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "summary": _summary(state, outcome),
        "state": state,
    }
    HISTORY_DIR.mkdir(exist_ok=True)
    path = HISTORY_DIR / f"{run['id']}.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, default=str, indent=1))
    tmp.replace(path)
    db.execute("UPDATE runs SET outcome = %s WHERE id = %s", (outcome, run["id"]))
    return path


def save_current() -> Path | None:
    """Snapshot the live run to history/. Never raises: history must not break the pipeline."""
    try:
        with _lock:
            run = current_run()
            return _write(run) if run else None
    except Exception as exc:
        log.warning("history save failed: %s", exc)
        return None


def archive_current(reason: str) -> str | None:
    """Close the live run and write its final snapshot. Call before the run tables are cleared."""
    try:
        with _lock:
            run = current_run()
            if not run:
                return None
            db.execute("UPDATE runs SET status = 'archived', ended_at = now() WHERE id = %s", (run["id"],))
            _write(db.query_one("SELECT * FROM runs WHERE id = %s", (run["id"],)), reason)
            return run["id"]
    except Exception as exc:
        log.warning("history archive failed: %s", exc)
        return None
