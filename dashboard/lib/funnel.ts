import { toMs } from "./format";
import { isAffected } from "./incidents";
import type { Tone } from "./labels";
import type { CveEvent, DashboardState } from "./types";

export interface FunnelStep {
  key: "received" | "keyword" | "candidates" | "matched" | "incidents";
  label: string;
  value: number;
  caption: string;
  tone: Tone;
}

export interface FunnelView {
  steps: FunnelStep[];
  /** CVEs are still arriving or waiting for stage 1. */
  streaming: boolean;
  matchedCves: CveEvent[];
  keywordCves: CveEvent[];
}

const STREAMING_WINDOW_MS = 3_000;

export function isFeedStreaming(state: DashboardState, dbNowMs: number): boolean {
  const lastReceived = toMs(state.funnel.last_received_at);
  return state.funnel.untriaged > 0 || (lastReceived !== null && dbNowMs - lastReceived < STREAMING_WINDOW_MS);
}

export function buildFunnel(state: DashboardState, dbNowMs: number): FunnelView {
  const f = state.funnel;
  const affected = state.incidents.filter(isAffected);
  const incidentCount = new Set(affected.map((incident) => incident.component)).size;
  const streaming = isFeedStreaming(state, dbNowMs);

  const incidentsCaption = affected.length
    ? `${affected.length} of ${state.services.length} services affected`
    : state.incidents.length
      ? "no service affected"
      : f.matched
        ? "scoring the affected services..."
        : "nothing to act on yet";

  return {
    streaming,
    matchedCves: state.matchedCves,
    keywordCves: state.keywordCves,
    steps: [
      {
        key: "received",
        label: "Received",
        value: f.total,
        tone: "neutral",
        caption: f.total === 0 ? "no CVEs received yet" : streaming ? "replaying the NVD feed..." : "CVEs in the replayed NVD feed",
      },
      {
        key: "keyword",
        label: "Keyword hits",
        value: f.keyword_hits,
        tone: "warning",
        caption: `a naive keyword script would alert ${f.keyword_hits} times`,
      },
      {
        key: "candidates",
        label: "Candidates",
        value: f.keyword_only,
        tone: "info",
        caption:
          f.candidates > 0
            ? `${f.candidates} waiting for the Triage agent`
            : f.keyword_only > 0
              ? `${f.triage_dismissed} dismissed by the Triage agent`
              : "keyword-only hits go to the Triage agent",
      },
      {
        key: "matched",
        label: "Matched",
        value: f.matched,
        tone: "danger",
        caption: f.matched ? state.matchedCves.map((cve) => cve.cve_id).join(", ") : "CPE match against the inventory",
      },
      {
        key: "incidents",
        label: "Incidents",
        value: incidentCount,
        tone: "danger",
        caption: incidentsCaption,
      },
    ],
  };
}
