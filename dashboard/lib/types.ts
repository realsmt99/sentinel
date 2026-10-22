// Wire format of the dashboard API. Row types mirror sentinel/db/schema.sql column for column:
// integers are numbers, timestamps are ISO strings, cvss is cast to float8 server-side.

export type ServiceStatus = "HEALTHY" | "PATCH_PENDING" | "OFFLINE" | "RESTORING";
export type Exposure = "public" | "internal";
export type TriageStatus = "NEW" | "CANDIDATE" | "DISMISSED" | "MATCHED";
export type AgentName = "triage" | "threat_intel" | "risk_scoring" | "containment" | "remediation";
export type RunStatus = "idle" | "running" | "done" | "failed" | "cached";
export type Band = "TAKE_OFFLINE" | "PR_ONLY" | "DIGEST" | "NONE";
export type IncidentStatus = "OPEN" | "MITIGATED" | "RESOLVED";
export type LogLevel = "info" | "warn" | "error" | "success";

export interface Service {
  id: number;
  name: string;
  container_name: string;
  language: string;
  runtime_version: string | null;
  runtime_mode: string | null;
  image: string | null;
  exposure: Exposure;
  monthly_revenue_eur: number;
  repo_path: string | null;
  status: ServiceStatus;
  last_seen: string;
}

/** feed_funnel view plus a few extra aggregates over cve_events. */
export interface Funnel {
  total: number;
  keyword_hits: number;
  untriaged: number;
  candidates: number;
  dismissed: number;
  matched: number;
  matched_components: number;
  /** Keyword hits without a CPE match: the CVEs handed to the Triage agent. */
  keyword_only: number;
  /** Keyword-only CVEs the Triage agent has dismissed so far. */
  triage_dismissed: number;
  first_received_at: string | null;
  last_received_at: string | null;
}

export interface CveEvent {
  id: number;
  cve_id: string;
  published: string;
  cvss: number | null;
  cvss_version: string | null;
  triage_status: TriageStatus;
  triage_reason: string | null;
  component: string | null;
  received_at: string;
  /** Truncated server-side. */
  description: string;
}

export interface AgentRun {
  id: number;
  component: string | null;
  agent: AgentName;
  service: string | null;
  status: RunStatus;
  last_tool: string | null;
  started_at: string | null;
  ended_at: string | null;
  output: unknown;
  error: string | null;
}

export interface LogLine {
  id: number;
  component: string | null;
  agent: AgentName | null;
  service: string | null;
  level: LogLevel;
  message: string;
  ts: string;
}

export interface Incident {
  id: number;
  component: string;
  cve_ids: string[];
  service_id: number;
  /** services.name, joined server-side. */
  service: string;
  danger_score: number | null;
  score_breakdown: Record<string, unknown>;
  band: Band | null;
  explanation: string | null;
  remediation: unknown;
  pr_url: string | null;
  status: IncidentStatus;
  created_at: string;
  mitigated_at: string | null;
  resolved_at: string | null;
  /** Earliest received_at of the incident's CVEs: the baseline for time to mitigate. */
  cve_received_at: string | null;
}

export interface ThreatIntelRow {
  id: number;
  component: string;
  cve_ids: string[];
  /** The Threat Intel agent's JSON; parse it defensively (lib/intel.ts). */
  data: unknown;
  fetched_at: string;
}

export interface DashboardState {
  ok: true;
  /** Database clock at query time, used to compute elapsed times against DB timestamps. */
  dbNow: string;
  services: Service[];
  funnel: Funnel;
  matchedCves: CveEvent[];
  /** Keyword-only CVEs (Triage agent input) with their triage verdicts. */
  keywordCves: CveEvent[];
  agentRuns: AgentRun[];
  /** Last 80 agent_log lines, oldest first. */
  log: LogLine[];
  incidents: Incident[];
  /** Newest threat_intel row per component. */
  threatIntel: ThreatIntelRow[];
}

export type StateErrorReason = "not_configured" | "unreachable" | "schema_missing" | "query_failed";

export interface StateError {
  ok: false;
  reason: StateErrorReason;
  message: string;
}

export type StateResponse = DashboardState | StateError;

/** GET /health values: capability booleans, plus `mode` ("live" | "fallback") and `busy` (null or the running job). */
export type HealthValue = boolean | string | null;

export type HealthResponse =
  | { reachable: true; agentUrl: string; checks: Record<string, HealthValue> }
  | { reachable: false; agentUrl: string; error: string };

export const ACTION_NAMES = ["connect", "replay", "restore", "reset"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export type ActionResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
