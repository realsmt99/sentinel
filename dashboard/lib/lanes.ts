import { prLabel, toMs } from "./format";
import { incidentPrUrl, parseRemediation } from "./incidents";
import { isRecord, parseThreatIntel } from "./intel";
import { AGENT_LABEL, AGENT_ORDER, AGENT_ROLE, band, runStatus, type Tone } from "./labels";
import type { AgentName, AgentRun, DashboardState, RunStatus } from "./types";

export interface LaneView {
  key: string;
  agent: AgentName;
  /** Service name, advisory, or what the lane works on. */
  heading: string;
  status: RunStatus;
  statusLabel: string;
  statusTone: Tone;
  /** No agent_runs row yet: the lane is drawn so the team is visible before it starts. */
  placeholder: boolean;
  lastTool: string | null;
  lastMessage: string | null;
  elapsedMs: number | null;
  summary: string | null;
  notes: string[];
  link: { label: string; url: string } | null;
  error: string | null;
}

export interface LaneGroup {
  agent: AgentName;
  title: string;
  role: string;
  lanes: LaneView[];
}

interface LaneContext {
  state: DashboardState;
  dbNowMs: number;
  lastMessages: Map<string, string>;
}

interface LaneSummary {
  summary: string | null;
  notes: string[];
  link: LaneView["link"];
}

const EMPTY: LaneSummary = { summary: null, notes: [], link: null };

const PLACEHOLDER_HINT: Record<AgentName, string> = {
  triage: "Starts when keyword-only CVEs arrive",
  threat_intel: "Starts on a CPE match",
  risk_scoring: "Scores this service after research",
  containment: "Runs for services scored >= 80",
  remediation: "Runs for every affected service",
};

function laneHeading(agent: AgentName, run: AgentRun | null, service: string | null): string {
  if (service) return service;
  if (agent === "triage") return "Keyword-only CVEs";
  if (run?.component) return `${run.component.toUpperCase()} advisory`;
  return "Not started";
}

const laneKey = (agent: AgentName, service: string | null) => `${agent}|${service ?? ""}`;

function elapsedMs(run: AgentRun, dbNowMs: number): number | null {
  if (run.status === "idle") return null;
  const start = toMs(run.started_at);
  const end = run.status === "running" ? dbNowMs : toMs(run.ended_at);
  return start === null || end === null ? null : Math.max(0, end - start);
}

function findIncident(state: DashboardState, component: string | null, service: string | null) {
  return state.incidents.find((i) => i.service === service && (component === null || i.component === component));
}

function summarize(agent: AgentName, run: AgentRun | null, service: string | null, ctx: LaneContext): LaneSummary {
  const { state } = ctx;
  const component = run?.component ?? null;

  switch (agent) {
    case "triage": {
      const f = state.funnel;
      if (f.keyword_only === 0) return EMPTY;
      const parts = [`${f.triage_dismissed} of ${f.keyword_only} keyword-only CVEs dismissed`];
      if (f.candidates > 0) parts.push(`${f.candidates} waiting`);
      const notes = state.keywordCves
        .filter((cve) => cve.triage_status === "DISMISSED" && cve.triage_reason)
        .slice(-3)
        .map((cve) => `${cve.cve_id}: ${cve.triage_reason}`);
      return { summary: parts.join(" · "), notes, link: null };
    }

    case "threat_intel": {
      if (!run) return EMPTY;
      const row = state.threatIntel.find((t) => t.component === component);
      const intel = row ? parseThreatIntel(row.data) : null;
      if (!intel) return EMPTY;
      const parts: string[] = [];
      if (intel.cvss !== null) parts.push(`CVSS ${intel.cvss}`);
      if (intel.exploitationReported !== null) {
        parts.push(intel.exploitationReported ? "exploitation reported" : "no exploitation reported");
      }
      if (intel.fixedVersions.length) parts.push(`fixes for ${intel.fixedVersions.length} branches`);
      if (intel.sources.length) parts.push(`${intel.sources.length} sources`);
      return { summary: parts.join(" · ") || null, notes: [], link: null };
    }

    case "risk_scoring": {
      const incident = run ? findIncident(state, component, service) : undefined;
      if (!incident || incident.danger_score === null) return EMPTY;
      const bandLabel = incident.band ? band(incident.band).label : "no band";
      return { summary: `Score ${incident.danger_score} · ${bandLabel}`, notes: [], link: null };
    }

    case "containment": {
      if (!run) return EMPTY;
      const output = isRecord(run.output) ? run.output : {};
      const message = typeof output.message === "string" ? output.message : null;
      const offline =
        output.offline === true || state.services.some((s) => s.name === service && s.status === "OFFLINE");
      const parts: string[] = [];
      if (offline) parts.push(`${service ?? "service"} offline`);
      if (output.alert_sent === true) parts.push("alert sent");
      return { summary: parts.join(" · ") || message, notes: parts.length && message ? [message] : [], link: null };
    }

    case "remediation": {
      if (!run) return EMPTY;
      const incident = findIncident(state, component, service);
      const remediation = parseRemediation(incident?.remediation) ?? parseRemediation(run.output);
      const prUrl = (incident && incidentPrUrl(incident)) ?? remediation?.prUrl ?? null;
      const parts: string[] = [];
      if (remediation?.targetVersion) parts.push(`target ${remediation.targetVersion}`);
      if (remediation?.fixVerified) parts.push("fix verified");
      if (remediation?.dockerTagVerified) parts.push("Docker tag verified");
      return {
        summary: parts.join(" · ") || null,
        notes: [],
        link: prUrl ? { label: prLabel(prUrl), url: prUrl } : null,
      };
    }
  }
}

function toLane(agent: AgentName, run: AgentRun | null, service: string | null, ctx: LaneContext): LaneView {
  const status: RunStatus = run?.status ?? "idle";
  const { label, tone } = runStatus(status);
  const { summary, notes, link } = summarize(agent, run, service, ctx);
  return {
    key: run ? `run-${run.id}` : `placeholder-${laneKey(agent, service)}`,
    agent,
    heading: laneHeading(agent, run, service),
    status,
    statusLabel: label,
    statusTone: tone,
    placeholder: !run,
    lastTool: run?.last_tool ?? null,
    lastMessage: run ? (ctx.lastMessages.get(laneKey(agent, service)) ?? null) : null,
    elapsedMs: run ? elapsedMs(run, ctx.dbNowMs) : null,
    summary: summary ?? (run ? null : PLACEHOLDER_HINT[agent]),
    notes,
    link,
    error: run?.error ?? null,
  };
}

export function buildLaneGroups(state: DashboardState, dbNowMs: number): LaneGroup[] {
  const lastMessages = new Map<string, string>();
  for (const line of state.log) {
    if (line.agent) lastMessages.set(laneKey(line.agent, line.service), line.message);
  }
  const ctx: LaneContext = { state, dbNowMs, lastMessages };
  const inventoryOrder = new Map(state.services.map((service, index) => [service.name, index]));
  const rank = (service: string | null) => (service === null ? -1 : (inventoryOrder.get(service) ?? inventoryOrder.size));

  return AGENT_ORDER.map((agent) => {
    const runs = state.agentRuns
      .filter((run) => run.agent === agent)
      .sort((a, b) => rank(a.service) - rank(b.service) || a.id - b.id);

    let lanes: LaneView[];
    if (agent === "risk_scoring") {
      // Every service gets scored, so its lane exists from the start.
      const perService = state.services.map((service) =>
        toLane(agent, runs.find((run) => run.service === service.name) ?? null, service.name, ctx),
      );
      const unknown = runs.filter((run) => !inventoryOrder.has(run.service ?? "")).map((run) => toLane(agent, run, run.service, ctx));
      lanes = [...perService, ...unknown];
    } else {
      lanes = runs.map((run) => toLane(agent, run, run.service, ctx));
    }
    if (lanes.length === 0) lanes = [toLane(agent, null, null, ctx)];

    return { agent, title: AGENT_LABEL[agent], role: AGENT_ROLE[agent], lanes };
  });
}
