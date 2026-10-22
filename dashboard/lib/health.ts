import { formatDuration, humanizeKey } from "./format";
import type { Tone } from "./labels";
import type { HealthResponse, HealthValue } from "./types";

export interface HealthItem {
  key: string;
  label: string;
  tone: Tone;
  detail: string;
}

export interface LiveStatus {
  label: string;
  tone: Tone;
  pulse: boolean;
}

// GET /health keys documented by the agent API; unknown keys still render.
const CHECK_LABEL: Record<string, string> = {
  db: "Agent DB",
  openai: "OpenAI",
  keenable: "Keenable",
  github: "GitHub",
  ntfy: "ntfy",
  docker: "Docker",
  listener: "Listener",
};

// Guard cannot act without these; the other integrations have code fallbacks.
const REQUIRED_CHECKS = new Set(["db", "docker", "listener"]);

function checkItem(key: string, value: HealthValue): HealthItem {
  switch (key) {
    case "mode":
      return value === "live"
        ? { key, label: "Agents: live", tone: "success", detail: "agents call OpenAI" }
        : { key, label: `Agents: ${value ?? "unknown"}`, tone: "warning", detail: "no OpenAI key: every lane runs deterministic code" };
    case "intel_offline":
      return value
        ? { key, label: "Intel: fixture", tone: "warning", detail: "INTEL_OFFLINE=1: threat intel comes from the saved fixture" }
        : { key, label: "Intel: live", tone: "success", detail: "cache first, then live research" };
    case "connected":
      return value
        ? { key, label: "Connected", tone: "success", detail: "services discovered" }
        : { key, label: "Not connected", tone: "muted", detail: "run Connect Guard" };
    case "busy":
      return value
        ? { key, label: "Busy", tone: "info", detail: typeof value === "string" ? value : "a job is running" }
        : { key, label: "Idle", tone: "muted", detail: "no job running" };
  }
  const label = CHECK_LABEL[key] ?? humanizeKey(key);
  if (value === true) return { key, label, tone: "success", detail: "ok" };
  return REQUIRED_CHECKS.has(key)
    ? { key, label, tone: "danger", detail: "failing" }
    : { key, label, tone: "warning", detail: "not configured: skipped or code fallback" };
}

export function buildHealthItems(
  health: HealthResponse | null,
  dashboardDb: { ok: boolean | null; detail: string },
): HealthItem[] {
  const items: HealthItem[] = [
    {
      key: "dashboard-db",
      label: "Dashboard DB",
      tone: dashboardDb.ok === null ? "muted" : dashboardDb.ok ? "success" : "danger",
      detail: dashboardDb.detail,
    },
  ];

  if (!health || !health.reachable) {
    items.push({
      key: "agent",
      label: "Agent API",
      tone: health ? "danger" : "muted",
      detail: health && !health.reachable ? health.error : "checking...",
    });
    for (const [key, label] of Object.entries(CHECK_LABEL)) {
      items.push({ key, label, tone: "muted", detail: "unknown while the agent API is down" });
    }
    return items;
  }

  items.push({ key: "agent", label: "Agent API", tone: "success", detail: health.agentUrl });
  for (const [key, value] of Object.entries(health.checks)) {
    items.push(checkItem(key, value));
  }
  return items;
}

export function buildLiveStatus(input: {
  hasSnapshot: boolean;
  failing: boolean;
  ageMs: number;
}): LiveStatus {
  if (!input.hasSnapshot) {
    return input.failing ? { label: "Not live", tone: "danger", pulse: false } : { label: "Connecting...", tone: "muted", pulse: true };
  }
  if (input.failing || input.ageMs > 5_000) {
    return { label: `Stale - last update ${formatDuration(input.ageMs)} ago`, tone: input.failing ? "danger" : "warning", pulse: false };
  }
  return { label: "Live", tone: "success", pulse: true };
}
