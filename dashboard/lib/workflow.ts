import { prLabel } from "./format";
import { isFeedStreaming } from "./funnel";
import { incidentPrUrl, parseRemediation } from "./incidents";
import { parseThreatIntel, type IntelView } from "./intel";
import { band as bandLabel, type Tone } from "./labels";
import type { AgentName, AgentRun, DashboardState, Incident, LogLine, Service } from "./types";

export type StepStatus = "waiting" | "active" | "done" | "skipped";

export type StepKey = "connect" | "feed" | "research" | "score" | "offline" | "prs" | "phone" | "restore";

export interface ScoreView {
  service: string;
  score: number;
  tone: Tone;
  bandLabel: string;
}

export interface PullRequestView {
  service: string;
  url: string;
  label: string;
  title: string;
}

export interface PhoneAlert {
  id: number;
  title: string;
  body: string;
  ts: string;
  url: string | null;
  urgent: boolean;
}

export type SiteState = "online" | "offline" | "restoring";

export interface WorkflowView {
  steps: Record<StepKey, StepStatus>;
  /** Latest thing the agent behind each step did, from agent_log. */
  activity: Partial<Record<StepKey, string>>;
  /** First step that is not finished: the one the presenter talks about. */
  current: StepKey | null;
  services: Service[];
  feed: { total: number; keywordHits: number; matched: number; cveIds: string[]; streaming: boolean };
  research: { intel: IntelView | null; lastTool: string | null };
  scores: ScoreView[];
  offline: { service: string; score: number } | null;
  pullRequests: PullRequestView[];
  prsSkippedReason: string | null;
  alerts: PhoneAlert[];
  alertsSkipped: boolean;
  site: { service: string; state: SiteState; version: string | null; url: string };
  restoredVersion: string | null;
}

const STEP_ORDER: StepKey[] = ["connect", "feed", "research", "score", "offline", "prs", "phone", "restore"];
const FINISHED: AgentRun["status"][] = ["done", "cached", "failed"];

const runsOf = (state: DashboardState, agent: AgentName) => state.agentRuns.filter((run) => run.agent === agent);
const allFinished = (runs: AgentRun[]) => runs.length > 0 && runs.every((run) => FINISHED.includes(run.status));

const SEND_ALERT = /send_alert\("(.+?)"\)/;

const STEP_LOG: Partial<Record<StepKey, (line: LogLine) => boolean>> = {
  feed: (l) => l.agent === "triage" || (l.agent === null && /^(Feed|Stage 1)/.test(l.message)),
  research: (l) => l.agent === "threat_intel",
  score: (l) => l.agent === "risk_scoring",
  offline: (l) => l.agent === "containment",
  prs: (l) => l.agent === "remediation",
  phone: (l) => /send_alert|phone alert/.test(l.message),
  restore: (l) => /restor/i.test(l.message),
};

function latestActivity(log: LogLine[]): Partial<Record<StepKey, string>> {
  const activity: Partial<Record<StepKey, string>> = {};
  for (const [key, matches] of Object.entries(STEP_LOG) as [StepKey, (line: LogLine) => boolean][]) {
    const line = [...log].reverse().find(matches);
    if (line) activity[key] = line.message;
  }
  return activity;
}

function shortPrLabel(url: string): string {
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  return number ? `PR #${number}` : prLabel(url);
}

function buildAlerts(lines: LogLine[], incidents: Incident[]): { alerts: PhoneAlert[]; skipped: boolean } {
  const alerts: PhoneAlert[] = [];
  let skipped = false;
  for (const line of lines) {
    const match = SEND_ALERT.exec(line.message);
    if (!match) continue;
    const wasSkipped = lines.some(
      (other) => other.id > line.id && other.id <= line.id + 6 && other.service === line.service && /skipped/i.test(other.message),
    );
    if (wasSkipped) {
      skipped = true;
      continue;
    }
    const incident = incidents.find((i) => i.service === line.service);
    const url = incident ? incidentPrUrl(incident) : null;
    const target = incident ? parseRemediation(incident.remediation)?.targetVersion : null;
    const urgent = line.agent === "containment";
    const body = urgent
      ? `${line.service} scored ${incident?.danger_score ?? "?"}/100 and was taken offline. ${url ? `Tap to review ${shortPrLabel(url)}.` : "Fix prepared."}`
      : `Fix ready for ${line.service}${target ? `: PHP ${target}` : ""}. It keeps serving meanwhile.`;
    alerts.push({ id: line.id, title: match[1], body, ts: line.ts, url, urgent });
  }
  return { alerts, skipped };
}

export function buildWorkflow(state: DashboardState, dbNowMs: number): WorkflowView {
  const { services, incidents, funnel } = state;
  const connected = services.length > 0;
  const streaming = funnel.total > 0 && isFeedStreaming(state, dbNowMs);

  const intelRow = state.threatIntel[0] ?? null;
  const intel = intelRow ? parseThreatIntel(intelRow.data) : null;
  const intelRuns = runsOf(state, "threat_intel");
  const scored = incidents.filter((i) => i.danger_score !== null);
  const scores: ScoreView[] = services.map((s) => {
    const incident = scored.find((i) => i.service === s.name);
    const b = incident?.band ? bandLabel(incident.band) : null;
    return {
      service: s.name,
      score: incident?.danger_score ?? 0,
      tone: b?.tone ?? "muted",
      bandLabel: incident ? (b?.label ?? "Scored") : "Waiting",
    };
  });

  const offlineIncident = incidents.find((i) => i.band === "TAKE_OFFLINE") ?? null;
  const offlineService = offlineIncident ? services.find((s) => s.name === offlineIncident.service) ?? null : null;
  const affected = incidents.filter((i) => i.band !== null && i.band !== "NONE");
  const pullRequests: PullRequestView[] = affected.flatMap((i) => {
    const url = incidentPrUrl(i);
    if (!url) return [];
    const target = parseRemediation(i.remediation)?.targetVersion;
    return [{ service: i.service, url, label: shortPrLabel(url), title: `Bump ${i.service} to PHP ${target ?? "patched"}` }];
  });
  const remediationRuns = runsOf(state, "remediation");
  const { alerts, skipped: alertsSkipped } = buildAlerts(state.alerts, incidents);

  const siteService = offlineService ?? services.find((s) => s.exposure === "public") ?? services[0] ?? null;
  const siteState: SiteState =
    siteService?.status === "OFFLINE" ? "offline" : siteService?.status === "RESTORING" ? "restoring" : "online";

  const steps = {} as Record<StepKey, StepStatus>;
  steps.connect = connected ? "done" : "active";
  steps.feed = !connected ? "waiting" : funnel.total === 0 || streaming ? "active" : "done";

  if (steps.feed !== "done") steps.research = "waiting";
  else if (funnel.matched === 0) steps.research = "skipped";
  else steps.research = intel || allFinished(intelRuns) ? "done" : "active";

  if (steps.research !== "done") steps.score = steps.research === "skipped" ? "skipped" : "waiting";
  else steps.score = scored.length >= services.length ? "done" : "active";

  const scoringDone = steps.score === "done";
  if (!scoringDone) steps.offline = steps.score === "skipped" ? "skipped" : "waiting";
  else if (!offlineIncident) steps.offline = "skipped";
  else steps.offline = offlineIncident.mitigated_at || offlineIncident.status === "RESOLVED" || siteState !== "online" ? "done" : "active";

  if (!scoringDone) steps.prs = steps.score === "skipped" ? "skipped" : "waiting";
  else if (affected.length === 0) steps.prs = "skipped";
  else steps.prs = pullRequests.length >= affected.length || allFinished(remediationRuns) ? "done" : "active";

  if (!scoringDone) steps.phone = steps.score === "skipped" ? "skipped" : "waiting";
  else if (alerts.length > 0) steps.phone = "done";
  else steps.phone = steps.prs === "done" ? "skipped" : "active";

  if (!scoringDone || !offlineIncident) steps.restore = !scoringDone && steps.score !== "skipped" ? "waiting" : "skipped";
  else steps.restore = offlineIncident.status === "RESOLVED" ? "done" : steps.offline === "done" ? "active" : "waiting";

  const prsSkippedReason =
    steps.prs === "done" && pullRequests.length === 0 ? "Fixes prepared, but GitHub is not configured, so no PR was opened." : null;

  return {
    steps,
    activity: latestActivity(state.log),
    current: STEP_ORDER.find((key) => steps[key] === "active") ?? null,
    services,
    feed: {
      total: funnel.total,
      keywordHits: funnel.keyword_hits,
      matched: funnel.matched,
      cveIds: state.matchedCves.map((cve) => cve.cve_id),
      streaming,
    },
    research: { intel, lastTool: intelRuns[0]?.last_tool ?? null },
    scores,
    offline: offlineIncident ? { service: offlineIncident.service, score: offlineIncident.danger_score ?? 0 } : null,
    pullRequests,
    prsSkippedReason,
    alerts,
    alertsSkipped,
    site: {
      service: siteService?.name ?? "shop",
      state: siteState,
      version: siteService?.runtime_version ?? null,
      url: state.targetUrl,
    },
    restoredVersion: offlineIncident?.status === "RESOLVED" ? (offlineService?.runtime_version ?? null) : null,
  };
}