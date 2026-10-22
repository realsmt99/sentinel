import { formatEurPerMonth, humanizeKey } from "./format";
import { incidentPrUrl } from "./incidents";
import { isRecord } from "./intel";
import { band, incidentStatus, runtimeLabel, runtimeModeLabel, serviceStatus, type LabelTone } from "./labels";
import type { DashboardState, Incident, Service } from "./types";

export interface BreakdownRow {
  key: string;
  label: string;
  points: number;
  note: string | null;
}

export interface Breakdown {
  rows: BreakdownRow[];
  facts: { label: string; value: string }[];
  /** Sum of the factor rows, before rounding and the 100 cap. */
  sum: number;
  /** Total reported inside score_breakdown, if any (e.g. the uncapped sum). */
  total: number | null;
}

export interface RiskView {
  incidentId: number;
  component: string;
  score: number | null;
  band: (LabelTone & { rule: string }) | null;
  /** Null when the service is not affected (band NONE). */
  incidentStatus: LabelTone | null;
  breakdown: Breakdown;
  explanation: string | null;
  prUrl: string | null;
}

export interface ServiceView {
  service: Service;
  runtime: string;
  runtimeMode: string | null;
  exposure: string;
  revenue: string;
  status: LabelTone;
  risk: RiskView | null;
  canRestore: boolean;
}

// Plan section 3 factor names, in display order; other keys still render under their own name.
const FACTORS: { keys: string[]; label: string }[] = [
  { keys: ["severity", "cvss"], label: "Severity (CVSS x 4)" },
  { keys: ["exploitation", "exploited", "exploitation_reported"], label: "Exploitation reported" },
  { keys: ["exposure"], label: "Exposure" },
  { keys: ["runtime_mode", "runtime", "sapi", "mode"], label: "Runtime mode" },
  { keys: ["revenue"], label: "Revenue >= 10k EUR/month" },
  { keys: ["no_fix", "no_official_fix", "unsupported_branch", "unsupported"], label: "No official fix for the branch" },
];
const TOTAL_KEYS = new Set(["total", "raw", "raw_total", "sum", "uncapped", "capped", "final", "score", "danger_score"]);
const NESTED_KEYS = ["factors", "components", "points", "breakdown"];
const NOTE_KEYS = ["reason", "note", "detail", "why", "explanation", "label"];

function toPoints(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  if (isRecord(value)) return toPoints(value.points ?? value.value ?? value.score);
  return null;
}

function noteOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const key = NOTE_KEYS.find((k) => typeof value[k] === "string");
  return key ? String(value[key]) : null;
}

function describe(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(describe).join(", ");
  return JSON.stringify(value)?.slice(0, 120) ?? "";
}

function factorOrder(key: string): number {
  const index = FACTORS.findIndex((factor) => factor.keys.includes(key.toLowerCase()));
  return index === -1 ? FACTORS.length : index;
}

export function parseBreakdown(value: unknown): Breakdown {
  const rows: BreakdownRow[] = [];
  const facts: Breakdown["facts"] = [];
  let total: number | null = null;

  let source: Record<string, unknown> = {};
  if (Array.isArray(value)) {
    for (const item of value.filter(isRecord)) {
      const name = String(item.factor ?? item.name ?? item.key ?? item.label ?? `factor ${rows.length + 1}`);
      const points = toPoints(item);
      if (points !== null) rows.push({ key: name, label: humanizeKey(name), points, note: noteOf(item) });
    }
  } else if (isRecord(value)) {
    source = value;
    const nestedKey = NESTED_KEYS.find((key) => isRecord(value[key]));
    if (nestedKey) {
      const { [nestedKey]: nested, ...rest } = value;
      source = { ...(nested as Record<string, unknown>), ...rest };
    }
  }

  for (const [key, raw] of Object.entries(source)) {
    const points = toPoints(raw);
    if (points !== null && TOTAL_KEYS.has(key.toLowerCase())) {
      total = points;
    } else if (points !== null) {
      const known = FACTORS.find((factor) => factor.keys.includes(key.toLowerCase()));
      rows.push({ key, label: known?.label ?? humanizeKey(key), points, note: noteOf(raw) });
    } else {
      facts.push({ label: humanizeKey(key), value: describe(raw) });
    }
  }

  rows.sort((a, b) => factorOrder(a.key) - factorOrder(b.key));
  const sum = Math.round(rows.reduce((acc, row) => acc + row.points, 0) * 10) / 10;
  return { rows, facts, sum, total };
}

function worstIncident(incidents: Incident[]): Incident | null {
  return incidents.reduce<Incident | null>(
    (worst, incident) =>
      !worst || (incident.danger_score ?? -1) > (worst.danger_score ?? -1) ? incident : worst,
    null,
  );
}

export function buildServiceViews(state: DashboardState): ServiceView[] {
  return state.services.map((service) => {
    const incident = worstIncident(state.incidents.filter((i) => i.service_id === service.id));
    return {
      service,
      runtime: runtimeLabel(service.language, service.runtime_version),
      runtimeMode: runtimeModeLabel(service.runtime_mode),
      exposure: service.exposure === "public" ? "Public" : "Internal",
      revenue: formatEurPerMonth(service.monthly_revenue_eur),
      status: serviceStatus(service.status),
      canRestore: service.status === "OFFLINE",
      risk: incident
        ? {
            incidentId: incident.id,
            component: incident.component,
            score: incident.danger_score,
            band: incident.band ? band(incident.band) : null,
            incidentStatus: incident.band === "NONE" ? null : incidentStatus(incident.status),
            breakdown: parseBreakdown(incident.score_breakdown),
            explanation: incident.explanation,
            prUrl: incidentPrUrl(incident),
          }
        : null,
    };
  });
}
