import "server-only";

import type { DashboardState, StateError } from "@/lib/types";
import { getPool, redact } from "./db";
import { getTargetUrl } from "./env";

const LOG_LINES = 80;
const KEYWORD_CVES = 60;

const truncated = (column: string, length: number) =>
  `CASE WHEN length(${column}) > ${length} THEN left(${column}, ${length}) || '...' ELSE ${column} END`;

// One statement, so the whole dashboard reads a single consistent snapshot in one round trip.
// Each column is a JSON document (node-pg parses json); cvss is numeric, hence ::float8.
const STATE_SQL = `
SELECT
  now() AS db_now,

  ( SELECT coalesce(json_agg(s ORDER BY (s.exposure = 'public') DESC, s.name), '[]')
      FROM ( SELECT id, name, container_name, language, runtime_version, runtime_mode, image,
                    exposure, monthly_revenue_eur, repo_path, status, last_seen
               FROM services ) s
  ) AS services,

  ( SELECT row_to_json(f)
      FROM ( SELECT ff.*, x.keyword_only, x.triage_dismissed, x.first_received_at, x.last_received_at
               FROM feed_funnel ff
              CROSS JOIN ( SELECT count(*) FILTER (WHERE keyword_match AND triage_status <> 'MATCHED')::int AS keyword_only,
                                  count(*) FILTER (WHERE keyword_match AND triage_status = 'DISMISSED')::int AS triage_dismissed,
                                  min(received_at) AS first_received_at,
                                  max(received_at) AS last_received_at
                             FROM cve_events ) x ) f
  ) AS funnel,

  ( SELECT coalesce(json_agg(c ORDER BY c.id), '[]')
      FROM ( SELECT id, cve_id, published, cvss::float8 AS cvss, cvss_version, triage_status,
                    triage_reason, component, received_at, ${truncated("description", 400)} AS description
               FROM cve_events
              WHERE triage_status = 'MATCHED' ) c
  ) AS matched_cves,

  ( SELECT coalesce(json_agg(c ORDER BY c.id), '[]')
      FROM ( SELECT id, cve_id, published, cvss::float8 AS cvss, cvss_version, triage_status,
                    triage_reason, component, received_at, ${truncated("description", 240)} AS description
               FROM cve_events
              WHERE keyword_match AND triage_status <> 'MATCHED'
              ORDER BY id
              LIMIT ${KEYWORD_CVES} ) c
  ) AS keyword_cves,

  ( SELECT coalesce(json_agg(r ORDER BY r.id), '[]')
      FROM ( SELECT id, component, agent, service, status, last_tool, started_at, ended_at, output, error
               FROM agent_runs ) r
  ) AS agent_runs,

  ( SELECT coalesce(json_agg(l ORDER BY l.id), '[]')
      FROM ( SELECT id, component, agent, service, level, message, ts
               FROM agent_log
              ORDER BY id DESC
              LIMIT ${LOG_LINES} ) l
  ) AS log,

  ( SELECT coalesce(json_agg(i ORDER BY i.danger_score DESC NULLS LAST, i.id), '[]')
      FROM ( SELECT inc.id, inc.component, inc.cve_ids, inc.service_id, s.name AS service,
                    inc.danger_score, inc.score_breakdown, inc.band, inc.explanation, inc.remediation,
                    inc.pr_url, inc.status, inc.created_at, inc.mitigated_at, inc.resolved_at,
                    coalesce(
                      ( SELECT min(c.received_at) FROM cve_events c WHERE c.cve_id = ANY (inc.cve_ids) ),
                      ( SELECT min(c.received_at) FROM cve_events c
                         WHERE c.triage_status = 'MATCHED' AND c.component = inc.component )
                    ) AS cve_received_at
               FROM incidents inc
               JOIN services s ON s.id = inc.service_id ) i
  ) AS incidents,

  ( SELECT row_to_json(r)
      FROM ( SELECT id, title, status, outcome, started_at FROM runs
              WHERE status = 'live' ORDER BY started_at DESC LIMIT 1 ) r
  ) AS run,

  ( SELECT coalesce(json_agg(m ORDER BY m.id), '[]')
      FROM ( SELECT id, run_id, role, text, card, ts FROM chat_messages
              WHERE run_id = ( SELECT id FROM runs WHERE status = 'live' ORDER BY started_at DESC LIMIT 1 ) ) m
  ) AS chat,

  ( SELECT coalesce(json_agg(a ORDER BY a.id), '[]')
      FROM ( SELECT id, component, agent, service, level, message, ts
               FROM agent_log
              WHERE message LIKE '%send_alert%' OR message LIKE '%phone alert%'
              ORDER BY id DESC
              LIMIT 20 ) a
  ) AS alerts,

  ( SELECT coalesce(json_agg(t ORDER BY t.component), '[]')
      FROM ( SELECT DISTINCT ON (component) id, component, cve_ids, data, fetched_at
               FROM threat_intel
              ORDER BY component, fetched_at DESC, id DESC ) t
  ) AS threat_intel
`;

interface StateRow {
  db_now: Date;
  services: DashboardState["services"];
  funnel: DashboardState["funnel"];
  matched_cves: DashboardState["matchedCves"];
  keyword_cves: DashboardState["keywordCves"];
  agent_runs: DashboardState["agentRuns"];
  log: DashboardState["log"];
  incidents: DashboardState["incidents"];
  threat_intel: DashboardState["threatIntel"];
  alerts: DashboardState["alerts"];
  run: DashboardState["run"];
  chat: DashboardState["chat"];
}

const SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "42883"]); // undefined table / column / function

function errorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String(err.code) : undefined;
}

function errorMessage(err: unknown): string {
  // Dual-stack connects (::1 and 127.0.0.1) fail with an AggregateError whose own message is empty.
  if (err instanceof AggregateError && err.errors.length) {
    return redact(err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; "));
  }
  return redact((err instanceof Error ? err.message : String(err)) || "no details");
}

export async function readDashboardState(): Promise<DashboardState | StateError> {
  const pool = getPool();
  if (!pool) {
    return {
      ok: false,
      reason: "not_configured",
      message: "DATABASE_URL is not set. Add it to the repo-root .env (next to .env.example).",
    };
  }

  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    const code = errorCode(err);
    return {
      ok: false,
      reason: "unreachable",
      message: `Cannot connect to the database${code ? ` (${code})` : ""}: ${errorMessage(err)}`,
    };
  }

  try {
    const { rows } = await client.query<StateRow>(STATE_SQL);
    const row = rows[0];
    return {
      ok: true,
      dbNow: row.db_now.toISOString(),
      services: row.services,
      funnel: row.funnel,
      matchedCves: row.matched_cves,
      keywordCves: row.keyword_cves,
      agentRuns: row.agent_runs,
      log: row.log,
      incidents: row.incidents,
      threatIntel: row.threat_intel,
      alerts: row.alerts,
      targetUrl: getTargetUrl(),
      chat: row.chat,
      run: row.run,
    };
  } catch (err) {
    const code = errorCode(err);
    if (code && SCHEMA_ERROR_CODES.has(code)) {
      return {
        ok: false,
        reason: "schema_missing",
        message: `The Guard schema is missing or outdated (${errorMessage(err)}). Apply sentinel/db/schema.sql with psql.`,
      };
    }
    return { ok: false, reason: "query_failed", message: `Dashboard query failed: ${errorMessage(err)}` };
  } finally {
    client.release();
  }
}
