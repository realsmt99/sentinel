"""Postgres access: a small sync psycopg pool. Async code calls these helpers via asyncio.to_thread."""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .config import get_settings

log = logging.getLogger("sentinel.db")

AGENT_LABELS = {
    "triage": "Triage",
    "threat_intel": "Threat Intel",
    "risk_scoring": "Risk Scoring",
    "containment": "Containment",
    "remediation": "Remediation",
}
LANE_FIELDS = ("status", "last_tool", "started_at", "ended_at", "output", "error")
_PY_LEVELS = {"info": logging.INFO, "success": logging.INFO, "warn": logging.WARNING, "error": logging.ERROR}


class DatabaseNotConfigured(RuntimeError):
    pass


_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def now() -> datetime:
    return datetime.now(UTC)


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                url = get_settings().database_url
                if not url:
                    raise DatabaseNotConfigured("DATABASE_URL is not set")
                _pool = ConnectionPool(
                    url,
                    min_size=1,
                    max_size=6,
                    timeout=15,
                    max_idle=300,
                    name="sentinel",
                    check=ConnectionPool.check_connection,
                    kwargs={"row_factory": dict_row, "application_name": "sentinel", "connect_timeout": 10},
                    open=True,
                )
    return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


@contextmanager
def connection(timeout: float | None = None) -> Iterator[psycopg.Connection]:
    """Pooled connection; the transaction commits when the block exits cleanly."""
    with pool().connection(timeout=timeout) as conn:
        yield conn


def query(q: Any, params: Any = None) -> list[dict]:
    with connection() as conn:
        return conn.execute(q, params).fetchall()


def query_one(q: Any, params: Any = None) -> dict | None:
    with connection() as conn:
        return conn.execute(q, params).fetchone()


def execute(q: Any, params: Any = None) -> int:
    with connection() as conn:
        return conn.execute(q, params).rowcount


def ping(timeout: float = 3.0) -> bool:
    try:
        with connection(timeout=timeout) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


# --- dashboard trace + lanes -------------------------------------------------------------------


def log_line(
    message: str,
    level: str = "info",
    *,
    component: str | None = None,
    agent: str | None = None,
    service: str | None = None,
) -> None:
    """Append to agent_log (the dashboard trace). Never raises."""
    log.log(_PY_LEVELS.get(level, logging.INFO), "%s", message)
    try:
        execute(
            "INSERT INTO agent_log (component, agent, service, level, message) VALUES (%s, %s, %s, %s, %s)",
            (component, agent, service, level, message[:2000]),
        )
    except Exception as exc:  # the trace must never break the pipeline
        log.warning("agent_log write failed: %s", exc)


def lane(component: str | None, agent: str, service: str | None = None, **fields: Any) -> None:
    """Upsert one dashboard lane (agent_runs row keyed by component, agent, service). Never raises."""
    unknown = set(fields) - set(LANE_FIELDS)
    if unknown:
        raise ValueError(f"unknown agent_runs fields: {sorted(unknown)}")
    cols = ["component", "agent", "service", *fields]
    values = [component, agent, service]
    for key, value in fields.items():
        values.append(Jsonb(value) if key == "output" and value is not None else value)
    if fields:
        action = sql.SQL("UPDATE SET ") + sql.SQL(", ").join(
            sql.SQL("{c} = EXCLUDED.{c}").format(c=sql.Identifier(key)) for key in fields
        )
    else:
        action = sql.SQL("NOTHING")
    q = sql.SQL(
        "INSERT INTO agent_runs ({cols}) VALUES ({vals}) ON CONFLICT ON CONSTRAINT agent_runs_lane_key DO {action}"
    ).format(
        cols=sql.SQL(", ").join(map(sql.Identifier, cols)),
        vals=sql.SQL(", ").join([sql.Placeholder()] * len(cols)),
        action=action,
    )
    try:
        execute(q, values)
    except Exception as exc:
        log.warning("agent_runs write failed (%s/%s/%s): %s", component, agent, service, exc)


def lane_idle(component: str | None, agent: str, service: str | None = None) -> None:
    lane(component, agent, service, status="idle", last_tool=None, started_at=None, ended_at=None, output=None, error=None)


def lane_start(component: str | None, agent: str, service: str | None = None) -> None:
    lane(component, agent, service, status="running", started_at=now(), ended_at=None, error=None)


def lane_finish(
    component: str | None,
    agent: str,
    service: str | None = None,
    *,
    status: str,
    output: Any = None,
    error: str | None = None,
) -> None:
    fields: dict[str, Any] = {"status": status, "ended_at": now(), "error": error}
    if output is not None:
        fields["output"] = output
    lane(component, agent, service, **fields)


def get_lane(component: str | None, agent: str, service: str | None = None) -> dict | None:
    return query_one(
        "SELECT * FROM agent_runs WHERE component IS NOT DISTINCT FROM %s AND agent = %s"
        " AND service IS NOT DISTINCT FROM %s",
        (component, agent, service),
    )


# --- services ---------------------------------------------------------------------------------


def load_services() -> list[dict]:
    return query("SELECT * FROM services ORDER BY id")


def get_service(name: str) -> dict | None:
    return query_one("SELECT * FROM services WHERE name = %s", (name,))


def services_count() -> int:
    row = query_one("SELECT count(*)::int AS n FROM services")
    return row["n"] if row else 0


def upsert_services(rows: list[dict], *, only_if_connected: bool = False) -> int:
    """Upsert the scanned inventory without touching status. only_if_connected skips the write when
    the table is empty (a demo reset cleared it while a periodic re-scan was running)."""
    if not rows:
        return 0
    return execute(
        """
        INSERT INTO services (name, container_name, language, runtime_version, runtime_mode, image,
                              exposure, monthly_revenue_eur, repo_path, last_seen)
        SELECT x.name, x.container_name, x.language, x.runtime_version, x.runtime_mode, x.image,
               x.exposure, x.monthly_revenue_eur, x.repo_path, now()
        FROM jsonb_to_recordset(%s) AS x(name text, container_name text, language text, runtime_version text,
                                          runtime_mode text, image text, exposure text,
                                          monthly_revenue_eur integer, repo_path text)
        WHERE NOT %s OR EXISTS (SELECT 1 FROM services)
        ON CONFLICT (name) DO UPDATE SET
            container_name      = EXCLUDED.container_name,
            language            = EXCLUDED.language,
            runtime_version     = COALESCE(EXCLUDED.runtime_version, services.runtime_version),
            runtime_mode        = EXCLUDED.runtime_mode,
            image               = EXCLUDED.image,
            exposure            = EXCLUDED.exposure,
            monthly_revenue_eur = EXCLUDED.monthly_revenue_eur,
            repo_path           = EXCLUDED.repo_path,
            last_seen           = now()
        """,
        (Jsonb(rows), only_if_connected),
    )


def update_service(name: str, **fields: Any) -> None:
    if not fields:
        return
    q = sql.SQL("UPDATE services SET {sets} WHERE name = %s").format(
        sets=sql.SQL(", ").join(sql.SQL("{c} = %s").format(c=sql.Identifier(k)) for k in fields)
    )
    execute(q, [*fields.values(), name])


# --- feed ---------------------------------------------------------------------------------------


def cve_count() -> int:
    row = query_one("SELECT count(*)::int AS n FROM cve_events")
    return row["n"] if row else 0


def insert_cve_chunk(conn: psycopg.Connection, rows: list[dict]) -> int:
    """One INSERT statement per chunk, so the statement-level trigger sends one cve_batch NOTIFY."""
    cur = conn.execute(
        """
        INSERT INTO cve_events (cve_id, published, description, cvss, cvss_version, cpes)
        SELECT x.cve_id, x.published, x.description, x.cvss, x.cvss_version, COALESCE(x.cpes, '[]'::jsonb)
        FROM jsonb_to_recordset(%s) AS x(cve_id text, published timestamptz, description text,
                                          cvss numeric, cvss_version text, cpes jsonb)
        ON CONFLICT (cve_id) DO NOTHING
        """,
        (Jsonb(rows),),
    )
    return cur.rowcount


def cve_rows_between(min_id: int, max_id: int) -> list[dict]:
    return query(
        "SELECT id, cve_id, description, cpes, triage_status FROM cve_events WHERE id BETWEEN %s AND %s ORDER BY id",
        (min_id, max_id),
    )


def cve_rows_with_status(status: str) -> list[dict]:
    return query(
        "SELECT id, cve_id, description, cpes, triage_status FROM cve_events WHERE triage_status = %s ORDER BY id",
        (status,),
    )


def update_triage(results: list[dict]) -> int:
    """Batch update: results carry id, triage_status, triage_reason, component and keyword_match."""
    if not results:
        return 0
    return execute(
        """
        UPDATE cve_events AS c
        SET triage_status = x.triage_status,
            triage_reason = x.triage_reason,
            component     = x.component,
            keyword_match = COALESCE(x.keyword_match, c.keyword_match)
        FROM jsonb_to_recordset(%s) AS x(id integer, triage_status text, triage_reason text,
                                          component text, keyword_match boolean)
        WHERE c.id = x.id
        """,
        (Jsonb(results),),
    )


def matched_by_component() -> dict[str, list[str]]:
    rows = query(
        "SELECT component, array_agg(cve_id ORDER BY cve_id) AS cve_ids FROM cve_events"
        " WHERE triage_status = 'MATCHED' AND component IS NOT NULL GROUP BY component ORDER BY component"
    )
    return {r["component"]: list(r["cve_ids"]) for r in rows}


def matched_cves(component: str) -> list[dict]:
    return query(
        "SELECT cve_id, description, cvss::float8 AS cvss, cvss_version, cpes FROM cve_events"
        " WHERE triage_status = 'MATCHED' AND component = %s ORDER BY cve_id",
        (component,),
    )


def cve_by_id(cve_id: str) -> dict | None:
    return query_one(
        "SELECT cve_id, description, cvss::float8 AS cvss, cvss_version, cpes, published FROM cve_events WHERE cve_id = %s",
        (cve_id,),
    )


def feed_funnel() -> dict:
    return query_one("SELECT * FROM feed_funnel") or {}


def notify(channel: str, payload: str = "") -> None:
    execute("SELECT pg_notify(%s, %s)", (channel, payload))


# --- threat intel -------------------------------------------------------------------------------


def latest_intel(component: str) -> dict | None:
    return query_one(
        "SELECT * FROM threat_intel WHERE component = %s ORDER BY fetched_at DESC, id DESC LIMIT 1", (component,)
    )


def save_intel(component: str, cve_ids: list[str], data: dict) -> None:
    execute(
        "INSERT INTO threat_intel (component, cve_ids, data) VALUES (%s, %s, %s)",
        (component, cve_ids, Jsonb(data)),
    )


# --- incidents ----------------------------------------------------------------------------------


def upsert_incident_score(
    component: str, cve_ids: list[str], service_id: int, score: int, breakdown: dict, band: str
) -> dict:
    return query_one(
        """
        INSERT INTO incidents (component, cve_ids, service_id, danger_score, score_breakdown, band)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (component, service_id) DO UPDATE SET
            cve_ids = EXCLUDED.cve_ids,
            danger_score = EXCLUDED.danger_score,
            score_breakdown = EXCLUDED.score_breakdown,
            band = EXCLUDED.band
        RETURNING *
        """,
        (component, cve_ids, service_id, score, Jsonb(breakdown), band),
    )


def get_incident(component: str, service_name: str) -> dict | None:
    return query_one(
        "SELECT i.*, s.name AS service FROM incidents i JOIN services s ON s.id = i.service_id"
        " WHERE i.component = %s AND s.name = %s",
        (component, service_name),
    )


def latest_incident_for_service(service_name: str) -> dict | None:
    return query_one(
        "SELECT i.*, s.name AS service FROM incidents i JOIN services s ON s.id = i.service_id"
        " WHERE s.name = %s ORDER BY i.created_at DESC, i.id DESC LIMIT 1",
        (service_name,),
    )


def incidents_for(component: str) -> list[dict]:
    return query(
        "SELECT i.*, s.name AS service FROM incidents i JOIN services s ON s.id = i.service_id"
        " WHERE i.component = %s ORDER BY s.id",
        (component,),
    )


def update_incident(incident_id: int, **fields: Any) -> None:
    if not fields:
        return
    values = [Jsonb(v) if k in {"remediation", "score_breakdown"} and v is not None else v for k, v in fields.items()]
    q = sql.SQL("UPDATE incidents SET {sets} WHERE id = %s").format(
        sets=sql.SQL(", ").join(sql.SQL("{c} = %s").format(c=sql.Identifier(k)) for k in fields)
    )
    execute(q, [*values, incident_id])


# --- reset --------------------------------------------------------------------------------------


def reset_tables(*, clear_services: bool = True, clear_intel: bool = False) -> None:
    tables = ["cve_events", "incidents", "agent_runs", "agent_log"]
    if clear_services:
        tables.append("services")
    if clear_intel:
        tables.append("threat_intel")
    with connection() as conn:
        conn.execute(
            sql.SQL("TRUNCATE {} RESTART IDENTITY").format(sql.SQL(", ").join(map(sql.Identifier, tables)))
        )
        if not clear_services:
            conn.execute("UPDATE services SET status = 'HEALTHY'")
