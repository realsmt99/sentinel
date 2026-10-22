import { diffMs, safeHttpUrl, toMs } from "./format";
import { isRecord, parseThreatIntel, type IntelView } from "./intel";
import { band, incidentStatus, type LabelTone } from "./labels";
import type { CveEvent, DashboardState, Incident, IncidentStatus } from "./types";

export interface RemediationView {
  targetVersion: string | null;
  fixVerified: boolean | null;
  dockerTagVerified: boolean | null;
  filesChanged: string[];
  prUrl: string | null;
  notes: string | null;
}

export interface IncidentRowView {
  id: number;
  service: string;
  score: number | null;
  band: (LabelTone & { rule: string }) | null;
  affected: boolean;
  /** Null for services that are not affected: their incident row is bookkeeping, not an open problem. */
  status: LabelTone | null;
  explanation: string | null;
  prUrl: string | null;
  remediation: RemediationView | null;
  createdAt: string;
  mitigatedAt: string | null;
  resolvedAt: string | null;
  receivedToOpenedMs: number | null;
  receivedToMitigatedMs: number | null;
  receivedToResolvedMs: number | null;
}

export interface IncidentGroupView {
  component: string;
  title: string;
  cveIds: string[];
  cves: CveEvent[];
  intel: IntelView | null;
  intelFetchedAt: string | null;
  intelFromCache: boolean;
  rows: IncidentRowView[];
  status: LabelTone;
  affectedCount: number;
  cveReceivedAt: string | null;
  openedAt: string | null;
  firstMitigatedAt: string | null;
  /** All three are measured from the moment the matched CVE was received. */
  timeToOpenMs: number | null;
  timeToMitigateMs: number | null;
  /** Until the latest resolution so far, once at least one affected service is patched. */
  timeToResolveMs: number | null;
  resolveDetail: string;
}

const STATUS_RANK: Record<IncidentStatus, number> = { OPEN: 0, MITIGATED: 1, RESOLVED: 2 };

function optionalBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function parseRemediation(value: unknown): RemediationView | null {
  if (!isRecord(value)) return null;
  const files = Array.isArray(value.files_changed) ? value.files_changed : [];
  const notes = value.notes;
  const target = value.target_version;
  return {
    targetVersion: typeof target === "string" || typeof target === "number" ? String(target) : null,
    fixVerified: optionalBool(value.fix_verified),
    dockerTagVerified: optionalBool(value.docker_tag_verified),
    filesChanged: files.map((file) =>
      typeof file === "string" ? file : isRecord(file) ? String(file.path ?? file.file ?? JSON.stringify(file)) : String(file),
    ),
    prUrl: safeHttpUrl(value.pr_url),
    notes: typeof notes === "string" ? notes : Array.isArray(notes) ? notes.map(String).join(" ") : null,
  };
}

export function incidentPrUrl(incident: Incident): string | null {
  return safeHttpUrl(incident.pr_url) ?? parseRemediation(incident.remediation)?.prUrl ?? null;
}

export function isAffected(incident: Incident): boolean {
  return incident.band !== null && incident.band !== "NONE";
}

function earliest(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    const ms = toMs(value);
    if (ms !== null && (best === null || ms < (toMs(best) ?? Infinity))) best = value;
  }
  return best;
}

function latest(values: (string | null)[]): string | null {
  let best: string | null = null;
  for (const value of values) {
    const ms = toMs(value);
    if (ms !== null && (best === null || ms > (toMs(best) ?? -Infinity))) best = value;
  }
  return best;
}

function toRow(incident: Incident): IncidentRowView {
  const received = incident.cve_received_at;
  return {
    id: incident.id,
    service: incident.service,
    score: incident.danger_score,
    band: incident.band ? band(incident.band) : null,
    affected: isAffected(incident),
    status: incident.band === "NONE" ? null : incidentStatus(incident.status),
    explanation: incident.explanation,
    prUrl: incidentPrUrl(incident),
    remediation: parseRemediation(incident.remediation),
    createdAt: incident.created_at,
    mitigatedAt: incident.mitigated_at,
    resolvedAt: incident.resolved_at,
    receivedToOpenedMs: diffMs(received, incident.created_at),
    receivedToMitigatedMs: diffMs(received, incident.mitigated_at),
    receivedToResolvedMs: diffMs(received, incident.resolved_at),
  };
}

export function buildIncidentGroups(state: DashboardState): IncidentGroupView[] {
  const byComponent = new Map<string, Incident[]>();
  for (const incident of state.incidents) {
    byComponent.set(incident.component, [...(byComponent.get(incident.component) ?? []), incident]);
  }

  return [...byComponent.entries()].map(([component, incidents]) => {
    const intelRow = state.threatIntel.find((row) => row.component === component) ?? null;
    const intel = intelRow ? parseThreatIntel(intelRow.data) : null;
    const listedIds = [...new Set(incidents.flatMap((incident) => incident.cve_ids ?? []))];
    const cves = state.matchedCves.filter((cve) =>
      listedIds.length ? listedIds.includes(cve.cve_id) : cve.component === component,
    );
    const affected = incidents.filter(isAffected);
    const worst = affected.reduce<Incident | null>(
      (acc, incident) => (!acc || STATUS_RANK[incident.status] < STATUS_RANK[acc.status] ? incident : acc),
      null,
    );
    const cveReceivedAt = earliest(incidents.map((incident) => incident.cve_received_at));
    const openedAt = earliest(incidents.map((incident) => incident.created_at));
    const firstMitigatedAt = earliest(affected.map((incident) => incident.mitigated_at));
    const resolved = affected.filter((incident) => incident.resolved_at);
    const stillOpen = affected.length - resolved.length;
    const resolveDetail =
      resolved.length === 0
        ? "waiting for human approval"
        : stillOpen === 0
          ? "all affected services patched"
          : `${resolved.map((incident) => incident.service).join(", ")} patched; ${stillOpen} still open`;
    const intelRun = state.agentRuns.find((run) => run.agent === "threat_intel" && run.component === component);

    return {
      component,
      title: intel?.name ?? `${component.toUpperCase()} runtime advisory`,
      cveIds: listedIds.length ? listedIds : cves.map((cve) => cve.cve_id),
      cves,
      intel,
      intelFetchedAt: intelRow?.fetched_at ?? null,
      intelFromCache: intelRun?.status === "cached",
      rows: incidents.map(toRow).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
      status: worst ? incidentStatus(worst.status) : { label: "No service affected", tone: "success" },
      affectedCount: affected.length,
      cveReceivedAt,
      openedAt,
      firstMitigatedAt,
      timeToOpenMs: diffMs(cveReceivedAt, openedAt),
      timeToMitigateMs: diffMs(cveReceivedAt, firstMitigatedAt),
      timeToResolveMs: diffMs(cveReceivedAt, latest(resolved.map((incident) => incident.resolved_at))),
      resolveDetail,
    };
  });
}
