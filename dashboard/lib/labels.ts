import type { AgentName, Band, IncidentStatus, LogLevel, RunStatus, ServiceStatus } from "./types";

/** Semantic colour of a value; components map tones to classes (components/ui/tone.ts). */
export type Tone = "neutral" | "muted" | "info" | "success" | "warning" | "danger";

export interface LabelTone {
  label: string;
  tone: Tone;
}

export const AGENT_ORDER: AgentName[] = ["triage", "threat_intel", "risk_scoring", "containment", "remediation"];

export const AGENT_LABEL: Record<AgentName, string> = {
  triage: "Triage",
  threat_intel: "Threat Intel",
  risk_scoring: "Risk Scoring",
  containment: "Containment",
  remediation: "Remediation",
};

export const AGENT_ROLE: Record<AgentName, string> = {
  triage: "Dismisses keyword hits that are PHP apps, not the runtime",
  threat_intel: "Researches the advisory: Keenable + NVD ranges",
  risk_scoring: "Deterministic danger score per service",
  containment: "Takes services offline when the score is >= 80",
  remediation: "Verifies the official fix and opens PRs",
};

const SERVICE_STATUS: Record<ServiceStatus, LabelTone> = {
  HEALTHY: { label: "Healthy", tone: "success" },
  PATCH_PENDING: { label: "Patch pending", tone: "warning" },
  OFFLINE: { label: "Offline", tone: "danger" },
  RESTORING: { label: "Restoring", tone: "info" },
};

const RUN_STATUS: Record<RunStatus, LabelTone> = {
  idle: { label: "Idle", tone: "muted" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cached: { label: "Cached", tone: "neutral" },
};

const BAND: Record<Band, LabelTone & { rule: string }> = {
  TAKE_OFFLINE: { label: "Take offline", tone: "danger", rule: ">= 80: contain now, fix PR, urgent alert" },
  PR_ONLY: { label: "PR only", tone: "warning", rule: "50-79: keep serving, fix PR, alert" },
  DIGEST: { label: "Digest", tone: "info", rule: "1-49: fix PR, no alert" },
  NONE: { label: "Not affected", tone: "success", rule: "0: installed version is not in an affected range" },
};

const INCIDENT_STATUS: Record<IncidentStatus, LabelTone> = {
  OPEN: { label: "Open", tone: "danger" },
  MITIGATED: { label: "Mitigated", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

const LOG_LEVEL_TONE: Record<LogLevel, Tone> = {
  info: "neutral",
  warn: "warning",
  error: "danger",
  success: "success",
};

const RUNTIME_MODE: Record<string, string> = {
  apache2handler: "mod_php (apache2handler)",
  "fpm-fcgi": "PHP-FPM (fpm-fcgi)",
  cli: "CLI",
};

const LANGUAGE: Record<string, string> = { php: "PHP", python: "Python", node: "Node.js" };

// Lookups fall back to the raw value so an unexpected status renders instead of crashing.
export const serviceStatus = (s: ServiceStatus): LabelTone => SERVICE_STATUS[s] ?? { label: s, tone: "neutral" };
export const runStatus = (s: RunStatus): LabelTone => RUN_STATUS[s] ?? { label: s, tone: "neutral" };
export const band = (b: Band) => BAND[b] ?? { label: b, tone: "neutral" as Tone, rule: "" };
export const incidentStatus = (s: IncidentStatus): LabelTone => INCIDENT_STATUS[s] ?? { label: s, tone: "neutral" };
export const logLevelTone = (l: LogLevel): Tone => LOG_LEVEL_TONE[l] ?? "neutral";

export function runtimeLabel(language: string, version: string | null): string {
  const name = LANGUAGE[language.toLowerCase()] ?? language;
  return version ? `${name} ${version}` : `${name} (version unknown)`;
}

export function runtimeModeLabel(mode: string | null): string | null {
  return mode ? (RUNTIME_MODE[mode] ?? mode) : null;
}

export function laneLabel(agent: AgentName | null, service: string | null): string {
  if (!agent) return "Guard";
  const name = AGENT_LABEL[agent] ?? agent;
  return service ? `${name} · ${service}` : name;
}
