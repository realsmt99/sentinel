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

/** A card attached to a Guard message; rendered from the run state. */
export interface ChatCard {
  type: "services" | "feed" | "funnel" | "intel" | "scores" | "site" | "pr" | "next" | string;
  service?: string;
  url?: string;
  /** Website state when the message was written (site cards). */
  state?: "online" | "offline";
  version?: string | null;
  status?: number | null;
}

export interface ChatMessage {
  id: number;
  run_id: string;
  role: "guard" | "user" | "event";
  text: string;
  card: ChatCard | null;
  ts: string;
}

export interface RunInfo {
  id: string;
  title: string;
  status: "live" | "archived";
  outcome: string | null;
  started_at: string;
}

/** One history/<id>.json file, as listed in the sidebar. */
export interface HistoryEntry {
  id: string;
  title: string;
  status: string;
  outcome: string;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
  summary: {
    services: string[];
    cves: number;
    matched: number;
    topService: string | null;
    topScore: number | null;
    prs: string[];
    messages: number;
  };
}

/** A whole history file: the entry plus the run state as it was at its last milestone. */
export interface HistoryDoc extends HistoryEntry {
  endReason: string | null;
  state: Omit<DashboardState, "ok" | "run">;
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
  /** agent_log lines about phone alerts (send_alert calls and their outcome), oldest first. */
  alerts: LogLine[];
  /** URL of the protected website (TARGET_URL). */
  targetUrl: string;
  /** Guard's narration of the live run, oldest first. */
  chat: ChatMessage[];
  /** The live run (null before the first Connect). */
  run: RunInfo | null;
}

export type StateErrorReason = "not_configured" | "unreachable" | "schema_missing" | "query_failed";

export interface StateError {
  ok: false;
  reason: StateErrorReason;
  message: string;
}

export type StateResponse = DashboardState | StateError;

/** GET /api/site: what the protected website served to a real request just now. */
export interface SiteCheck {
  url: string;
  status: number | null;
  ms: number;
  /** The Guard maintenance page was served. */
  maintenance: boolean;
  /** From the shop footer ("Powered by PHP x.y.z"). */
  phpVersion: string | null;
  error: string | null;
  checkedAt: string;
}

/** GET /health values: capability booleans, plus `mode` ("live" | "fallback") and `busy` (null or the running job). */
export type HealthValue = boolean | string | null;

export type HealthResponse =
  | { reachable: true; agentUrl: string; checks: Record<string, HealthValue> }
  | { reachable: false; agentUrl: string; error: string };

export const ACTION_NAMES = ["connect", "replay", "restore", "reset", "newrun"] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export type ActionResponse = ({ ok: true } & Record<string, unknown>) | { ok: false; error: string };
