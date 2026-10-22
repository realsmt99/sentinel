import { diffMs, formatCount, formatDuration, formatEurPerMonth } from "./format";
import { isFeedStreaming } from "./funnel";
import type { Tone } from "./labels";
import type { DashboardState } from "./types";

export interface HeroStat {
  label: string;
  value: string;
  hint: string;
}

export interface Headline {
  eyebrow: string;
  title: string;
  body: string;
  tone: Tone;
  stats: HeroStat[];
}

function buildStats(state: DashboardState): HeroStat[] {
  const { services, incidents, funnel } = state;
  if (funnel.total === 0) {
    const revenue = services.reduce((sum, s) => sum + s.monthly_revenue_eur, 0);
    return [
      { label: "Services", value: formatCount(services.length), hint: "discovered from Docker labels" },
      { label: "Public-facing", value: formatCount(services.filter((s) => s.exposure === "public").length), hint: "reachable from the internet" },
      { label: "Revenue watched", value: formatEurPerMonth(revenue), hint: "at stake if we over-react" },
    ];
  }
  const groups = new Set(incidents.filter((i) => i.band !== null && i.band !== "NONE").map((i) => i.component)).size;
  const mitigations = incidents
    .map((i) => diffMs(i.cve_received_at, i.mitigated_at))
    .filter((ms): ms is number => ms !== null);
  const serving = services.filter((s) => s.status !== "OFFLINE" && s.status !== "RESTORING").length;
  return [
    {
      label: "Alerts",
      value: `${formatCount(funnel.keyword_hits)} → ${formatCount(groups)}`,
      hint: "keyword script vs Sentinel incidents",
    },
    {
      label: "Time to mitigate",
      value: mitigations.length ? formatDuration(Math.min(...mitigations)) : "-",
      hint: "from CVE received to contained",
    },
    { label: "Still serving", value: `${serving} / ${services.length}`, hint: "services kept online" },
  ];
}

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** One sentence that tells a judge where the demo is, derived from the live state. */
export function buildHeadline(state: DashboardState, dbNowMs: number): Headline {
  return { ...buildMessage(state, dbNowMs), stats: buildStats(state) };
}

function buildMessage(state: DashboardState, dbNowMs: number): Omit<Headline, "stats"> {
  const { services, incidents, funnel } = state;
  const scored = incidents.filter((i) => i.danger_score !== null && i.band !== null && i.band !== "NONE");
  const offline = services.filter((s) => s.status === "OFFLINE" || s.status === "RESTORING");
  const prs = scored.filter((i) => i.pr_url).length;

  if (funnel.total === 0) {
    return {
      eyebrow: "Watching",
      title: `${services.length} services under watch`,
      body: `Sentinel discovered ${list(services.map((s) => s.name))} from their Docker labels and live runtimes. Replay the NVD feed of 21 October 2026 to see what it does with 544 new CVEs.`,
      tone: "success",
    };
  }

  if (scored.length === 0) {
    const streaming = isFeedStreaming(state, dbNowMs);
    return {
      eyebrow: streaming ? "Reading the feed" : "Triage",
      title: streaming ? `${funnel.total} CVEs received` : `${funnel.matched} of ${funnel.total} CVEs match what we run`,
      body: funnel.matched
        ? "The agent team is researching the match and scoring every service."
        : "Every CVE is matched against the inventory by code first; only real matches reach the agent team.",
      tone: "info",
    };
  }

  const prText = prs ? `${prs} fix ${prs === 1 ? "PR is" : "PRs are"} open` : "fixes are prepared";
  if (offline.length > 0) {
    const worst = scored.reduce((a, b) => ((b.danger_score ?? 0) > (a.danger_score ?? 0) ? b : a));
    return {
      eyebrow: "Contained",
      title: `${list(offline.map((s) => s.name))} ${offline.length === 1 ? "is" : "are"} offline, ${prText}`,
      body: `${worst.service} scored ${worst.danger_score}/100, so Containment put it behind the maintenance page. Everything else keeps serving. Approve the restore once the patch is reviewed.`,
      tone: "danger",
    };
  }

  const resolved = scored.filter((i) => i.status === "RESOLVED");
  if (resolved.length > 0) {
    const restored = services.filter((s) => resolved.some((i) => i.service === s.name));
    return {
      eyebrow: "Resolved",
      title: "Contained, patched, back online",
      body: `${list(restored.map((s) => `${s.name} on ${s.runtime_version ?? "the patched version"}`))}. ${prText[0].toUpperCase()}${prText.slice(1)} for review.`,
      tone: "success",
    };
  }

  return {
    eyebrow: "Patching",
    title: `Nothing had to go offline, ${prText}`,
    body: "Every affected service scored below the containment threshold, so it keeps serving while the fix is reviewed.",
    tone: "warning",
  };
}
