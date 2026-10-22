"use client";

import type { ReactNode } from "react";
import { ArrowUpRight, Bell, GitPullRequest } from "@phosphor-icons/react";
import { useCountUp } from "@/hooks/use-count-up";
import type { ActionControl } from "@/lib/actions";
import { diffMs, displayUrl, formatCount, formatDuration, formatEurPerMonth } from "@/lib/format";
import { parseRemediation } from "@/lib/incidents";
import { runtimeLabel, runtimeModeLabel } from "@/lib/labels";
import { buildTrace } from "@/lib/trace";
import type { DashboardState, SiteCheck } from "@/lib/types";
import type { StepKey, StepStatus, WorkflowView } from "@/lib/workflow";
import { ActionButtonView } from "../action-bar";
import { ConnectForm, type ConnectionValues } from "./connect-form";
import { Phone } from "../workflow/phone";
import { Terminal } from "../workflow/terminal";
import { WebsitePreview } from "../workflow/website-preview";
import { PASTEL, Tag } from "./tag";

export type SceneKey = StepKey | "summary";

export const SCENES: { key: SceneKey; short: string }[] = [
  { key: "connect", short: "Connect" },
  { key: "feed", short: "CVE feed" },
  { key: "research", short: "Research" },
  { key: "score", short: "Score" },
  { key: "offline", short: "Stop site" },
  { key: "prs", short: "Pull requests" },
  { key: "phone", short: "Phone" },
  { key: "restore", short: "Restore" },
  { key: "summary", short: "Summary" },
];

export interface SceneContext {
  view: WorkflowView;
  state: DashboardState;
  site: SiteCheck | null;
  controls: { connect: ActionControl; replay: ActionControl; restore: ActionControl };
  onRun: (control: ActionControl) => void;
  connectWith: (values: ConnectionValues) => void;
  nowMs: number;
}

interface SceneCopy {
  headline: string;
  summary: string;
  activity?: string;
  cta?: ReactNode;
  /** The step waits for the presenter (a button in the copy or in the visual). */
  human?: boolean;
}

const card = "rounded-xl border border-line bg-white";

export function sceneStatus(key: SceneKey, view: WorkflowView): StepStatus {
  if (key === "summary") {
    if (view.feed.total === 0) return "waiting";
    return view.current === null ? "done" : "active";
  }
  return view.steps[key];
}

export function sceneCopy(key: SceneKey, ctx: SceneContext): SceneCopy {
  const { view, controls, onRun } = ctx;
  const { steps, feed, offline } = view;
  const intel = view.research.intel;
  const cta = (control: ActionControl) => <ActionButtonView control={control} onRun={onRun} theme="light" />;

  switch (key) {
    case "connect":
      return {
        headline: steps.connect === "done" ? "Your project is connected" : "Connect your project",
        summary:
          steps.connect === "done"
            ? `Guard found ${view.services.length} running services from their Docker labels and checked what each container really runs. The inventory is now stored in Aiven.`
            : "Guard works with any project: point it at your Aiven database, GitHub repository, Docker project, website and phone. Test each connection, then connect.",
        human: steps.connect !== "done",
      };
    case "feed":
      return {
        headline: feed.total === 0 ? "544 new CVEs are waiting" : `${formatCount(feed.total)} new CVEs arrive`,
        summary:
          feed.total === 0
            ? "Replay the real NVD feed of 21 October 2026. Every CVE is written to Aiven, and Aiven wakes the agent with a notification."
            : feed.streaming
              ? "Each CVE is matched against the inventory as it lands in Aiven."
              : `${feed.keywordHits} of them mention PHP, so a keyword script would page you ${feed.keywordHits} times. Only ${feed.matched} affect the PHP you actually run.`,
        activity: feed.total > 0 && steps.feed === "active" ? view.activity.feed : undefined,
        cta: feed.total === 0 ? cta(controls.replay) : undefined,
      };
    case "research":
      return {
        headline: "The agents research the threat",
        summary:
          steps.research === "done" && intel
            ? `CVSS ${intel.cvss ?? "?"}. ${intel.exploitationReported ? "Exploitation is reported in the wild." : "No exploitation reported yet."} Fixed in ${intel.fixedVersions.map((f) => f.version).filter(Boolean).join(", ") || "patched releases"}.`
            : "The Threat Intel agent reads the NVD fix ranges, then searches php.net, CISA and security blogs through Keenable.",
        activity: steps.research === "active" ? view.activity.research : undefined,
      };
    case "score":
      return {
        headline: "Every service gets a danger score",
        summary: "Code, not the model, computes the score: severity, exploitation, exposure, runtime mode and revenue. 80 or more means the service goes offline now.",
        activity: steps.score === "active" ? view.activity.score : undefined,
      };
    case "offline":
      return {
        headline: steps.offline === "skipped" ? "Nothing had to go offline" : "High score: the website is stopped",
        summary:
          steps.offline === "skipped"
            ? "No service scored 80 or more, so everything keeps serving while the fixes are reviewed."
            : offline
              ? `${offline.service} scored ${offline.score}, so the Containment agent stopped its container and switched on the maintenance page. The other services keep serving.`
              : "Services scoring 80 or more are stopped behind a maintenance page.",
        activity: steps.offline === "active" ? view.activity.offline : undefined,
      };
    case "prs":
      return {
        headline: "Fix pull requests on GitHub",
        summary:
          view.prsSkippedReason ??
          (view.pullRequests.length > 0
            ? "The Remediation agents confirmed the official release and the Docker image, then opened one pull request per affected service. They never merge."
            : "The Remediation agents verify the official fix, then edit the Dockerfile and composer.json."),
        activity: steps.prs === "active" ? view.activity.prs : undefined,
      };
    case "phone":
      return {
        headline: "Your phone is alerted",
        summary:
          view.alerts.length > 0
            ? `${view.alerts.length} push ${view.alerts.length === 1 ? "notification" : "notifications"} through ntfy: urgent for the stopped site, normal for a fix. Tap one to open its pull request.`
            : view.alertsSkipped
              ? "Alerts were skipped: no ntfy topic is configured."
              : "An urgent alert for a stopped service, a normal one for each fix.",
        activity: steps.phone === "active" ? view.activity.phone : undefined,
      };
    case "restore":
      return {
        headline: steps.restore === "done" ? "Back online, patched" : "A human approves the restore",
        summary:
          steps.restore === "done"
            ? `${offline?.service ?? "The service"} runs PHP ${view.restoredVersion ?? "the patched version"} again and the maintenance page is gone.`
            : steps.restore === "skipped"
              ? "Nothing was taken offline, so there is nothing to restore."
              : `Review the pull request, then bring ${offline?.service ?? "the service"} back on the patched version. Guard never restores on its own.`,
        activity: steps.restore === "active" ? view.activity.restore : undefined,
        cta: steps.restore === "active" ? cta(controls.restore) : undefined,
      };
    case "summary":
      return {
        headline: "Everything that happened",
        summary: "One real feed, one incident, every decision stored in Aiven.",
      };
  }
}

export function SceneVisual({ sceneKey, ctx }: { sceneKey: SceneKey; ctx: SceneContext }) {
  switch (sceneKey) {
    case "connect":
      return <ConnectVisual ctx={ctx} />;
    case "feed":
      return <FeedVisual view={ctx.view} />;
    case "research":
      return <ResearchVisual ctx={ctx} />;
    case "score":
      return <ScoreVisual view={ctx.view} />;
    case "offline":
    case "restore":
      return <WebsitePreview site={ctx.view.site} check={ctx.site} tall />;
    case "prs":
      return <PullRequestsVisual ctx={ctx} />;
    case "phone":
      return (
        <div className="flex justify-center py-2">
          <Phone alerts={ctx.view.alerts} nowMs={ctx.nowMs} />
        </div>
      );
    case "summary":
      return <SummaryVisual ctx={ctx} />;
  }
}

const LABELS_SNIPPET = `services:
  shop:
    labels:
      sentinel.service: "shop"
      sentinel.language: "php"
      sentinel.exposure: "public"
      sentinel.revenue: "40000"
      sentinel.repo_path: "target-system/shop/Dockerfile"`;

function ConnectVisual({ ctx }: { ctx: SceneContext }) {
  const { services } = ctx.view;
  if (services.length === 0) {
    return (
      <div className="space-y-4">
        <ConnectForm control={ctx.controls.connect} onConnect={ctx.connectWith} />
        <details className="rounded-xl border border-line bg-white">
          <summary className="cursor-pointer list-none px-5 py-3 text-xs text-mute transition-colors duration-200 hover:text-ink">
            What any project needs: labels on its containers and one Nginx line
          </summary>
          <pre className="overflow-x-auto border-t border-line bg-bone-50 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">{LABELS_SNIPPET}</pre>
        </details>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {services.length > 0 && (
        <ul className={`${card} divide-y divide-line`}>
          {services.map((s, i) => (
            <li
              key={s.id}
              style={{ animationDelay: `${i * 90}ms` }}
              className="grid animate-rise grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
            >
              <span className="font-medium text-ink">{s.name}</span>
              <span className="hidden text-sm text-mute sm:block">
                {runtimeLabel(s.language, s.runtime_version)}
                {s.runtime_mode ? ` · ${runtimeModeLabel(s.runtime_mode)}` : ""}
              </span>
              <span className="flex items-center gap-2">
                <Tag tone={s.exposure === "public" ? "warning" : "neutral"}>{s.exposure}</Tag>
                <span className="w-24 text-right font-mono text-xs text-mute">{formatEurPerMonth(s.monthly_revenue_eur)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <figure className={`${card} overflow-hidden`}>
        <figcaption className="border-b border-line px-4 py-2 font-mono text-[11px] text-mute">target-system/docker-compose.yml</figcaption>
        <pre className="overflow-x-auto bg-bone-50 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink-soft">{LABELS_SNIPPET}</pre>
        <figcaption className="border-t border-line px-4 py-2 font-mono text-[11px] text-mute">
          nginx: <span className="text-ink-soft">include /etc/nginx/sentinel/killswitch.conf;</span>
        </figcaption>
      </figure>
    </div>
  );
}

function Counter({ value, label, tone, ratio }: { value: number; label: string; tone: keyof typeof PASTEL; ratio: number }) {
  const shown = useCountUp(value);
  const p = PASTEL[tone];
  return (
    <div className={`${card} p-6`}>
      <div className={`font-mono text-5xl font-medium tabular-nums tracking-tight ${tone === "neutral" ? "text-ink" : p.text}`}>{formatCount(shown)}</div>
      <div className="mt-2 text-sm text-mute">{label}</div>
      <div className="mt-5 h-1 overflow-hidden rounded-full bg-bone-100">
        <div
          className={`h-full w-full origin-left animate-fill rounded-full transition-transform duration-1000 ease-out-expo ${p.bar}`}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </div>
  );
}

function FeedVisual({ view }: { view: WorkflowView }) {
  const { feed } = view;
  const total = Math.max(feed.total, 1);
  const ratio = (n: number) => (n > 0 ? Math.max(n / total, 0.02) : 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Counter value={feed.total} label="CVEs published on 21 Oct" tone="neutral" ratio={ratio(feed.total)} />
        <Counter value={feed.keywordHits} label="mention PHP" tone="warning" ratio={ratio(feed.keywordHits)} />
        <Counter value={feed.matched} label="affect what we run" tone="danger" ratio={ratio(feed.matched)} />
      </div>
      {feed.cveIds.length > 0 && (
        <div className={`${card} flex flex-wrap items-center gap-3 px-5 py-4`}>
          <span className="text-sm text-mute">PHP2Shell</span>
          {feed.cveIds.map((id) => (
            <a
              key={id}
              href={`https://nvd.nist.gov/vuln/detail/${id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {id}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function ResearchVisual({ ctx }: { ctx: SceneContext }) {
  const intel = ctx.view.research.intel;
  const lines = buildTrace(ctx.state.log.filter((l) => l.agent === "threat_intel"));
  const sites = [
    ...new Map(
      (intel?.sources ?? []).filter((s) => s.url).map((s) => [displayUrl(s.url as string).split("/")[0], s.url as string] as const),
    ),
  ].slice(0, 6);
  return (
    <div className="space-y-4">
      <div className="h-[300px]">
        <Terminal lines={lines} busy={ctx.view.steps.research === "active"} />
      </div>
      {intel && (
        <div className={`${card} space-y-4 p-5`}>
          <div className="flex flex-wrap gap-2">
            <Tag tone="danger">CVSS {intel.cvss ?? "?"}</Tag>
            <Tag tone={intel.exploitationReported ? "danger" : "neutral"}>
              {intel.exploitationReported ? "Exploited in the wild" : "No exploitation reported"}
            </Tag>
            {intel.highRiskRuntimeModes.map((m) => (
              <Tag key={m} tone="warning">
                High risk: {m}
              </Tag>
            ))}
          </div>
          {sites.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {sites.map(([site, url]) => (
                <a
                  key={site}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-xs text-ink-soft transition-colors duration-200 hover:bg-bone-50"
                >
                  {site}
                  <ArrowUpRight size={11} weight="bold" />
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScoreVisual({ view }: { view: WorkflowView }) {
  return (
    <div className={`${card} p-6`}>
      <ul className="space-y-6">
        {view.scores.map((s, i) => (
          <li key={s.service} style={{ animationDelay: `${i * 120}ms` }} className="animate-rise">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-medium text-ink">{s.service}</span>
              <span className="flex items-center gap-3">
                <Tag tone={s.tone}>{s.bandLabel}</Tag>
                <span className={`w-12 text-right font-mono text-3xl font-medium tabular-nums ${s.tone === "muted" ? "text-mute" : PASTEL[s.tone].text}`}>
                  {s.score}
                </span>
              </span>
            </div>
            <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-bone-100">
              <div
                className={`h-full w-full origin-left rounded-full transition-transform duration-[1400ms] ease-out-expo ${PASTEL[s.tone].bar}`}
                style={{ transform: `scaleX(${s.score / 100})` }}
              />
              <span className="absolute inset-y-0 left-[80%] w-px bg-ink/40" />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-6 border-t border-line pt-4 text-xs text-mute">The line marks 80: at or above it, the service is taken offline.</p>
    </div>
  );
}

function PullRequestsVisual({ ctx }: { ctx: SceneContext }) {
  const { view, state } = ctx;
  const affected = state.incidents.filter((i) => i.band !== null && i.band !== "NONE");
  if (view.pullRequests.length === 0) {
    return (
      <div className={`${card} p-6 text-sm leading-relaxed text-mute`}>
        {affected.length === 0
          ? "No affected service, so no pull request."
          : affected.map((i) => <p key={i.id}>{parseRemediation(i.remediation)?.notes ?? `${i.service}: fix prepared.`}</p>)}
      </div>
    );
  }
  return (
    <ul className="space-y-4">
      {view.pullRequests.map((pr, i) => {
        const service = state.services.find((s) => s.name === pr.service);
        const target = /PHP ([\d.]+)/.exec(pr.title)?.[1] ?? null;
        const from = service?.runtime_version && service.runtime_version !== target ? service.runtime_version : null;
        return (
          <li key={pr.url} style={{ animationDelay: `${i * 120}ms` }} className={`${card} animate-rise overflow-hidden`}>
            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-bone-50">
              <span className="flex size-9 items-center justify-center rounded-md bg-pale-green text-pale-green-ink">
                <GitPullRequest size={18} weight="bold" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{pr.label}</span>
                <span className="block text-sm text-mute">{pr.title}</span>
              </span>
              <span className="flex items-center gap-1 text-sm text-ink transition-transform duration-200 group-hover:translate-x-0.5">
                Open on GitHub
                <ArrowUpRight size={14} weight="bold" />
              </span>
            </a>
            {from && target && (
              <pre className="border-t border-line bg-bone-50 px-5 py-3 font-mono text-[12px] leading-relaxed">
                <span className="text-mute">{`target-system/${pr.service}/Dockerfile\n`}</span>
                <span className="text-pale-red-ink">{`- ARG PHP_VERSION=${from}\n`}</span>
                <span className="text-pale-green-ink">{`+ ARG PHP_VERSION=${target}\n`}</span>
                <span className="text-mute">{`target-system/${pr.service}/composer.json\n`}</span>
                <span className="text-pale-red-ink">{`-   "php": "^${from}"\n`}</span>
                <span className="text-pale-green-ink">{`+   "php": "^${target}"`}</span>
              </pre>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: keyof typeof PASTEL }) {
  return (
    <div>
      <div className={`font-mono text-3xl font-medium tabular-nums tracking-tight ${tone === "neutral" ? "text-ink" : PASTEL[tone].text}`}>{value}</div>
      <div className="mt-1 text-xs text-mute">{label}</div>
    </div>
  );
}

function SummaryVisual({ ctx }: { ctx: SceneContext }) {
  const { view, state, site } = ctx;
  const mitigations = state.incidents
    .map((i) => diffMs(i.cve_received_at, i.mitigated_at))
    .filter((ms): ms is number => ms !== null);
  const serving = state.services.filter((s) => s.status !== "OFFLINE" && s.status !== "RESTORING").length;
  return (
    <div className="grid gap-4 md:grid-cols-6">
      <div className={`${card} grid grid-cols-2 gap-6 p-6 md:col-span-4 md:grid-cols-4`}>
        <Stat label="CVEs read" value={formatCount(view.feed.total)} />
        <Stat label="would alert by keyword" value={formatCount(view.feed.keywordHits)} tone="warning" />
        <Stat label="real matches" value={formatCount(view.feed.matched)} tone="danger" />
        <Stat label="time to contain" value={mitigations.length ? formatDuration(Math.min(...mitigations)) : "-"} tone="success" />
      </div>
      <div className={`${card} p-6 md:col-span-2`}>
        <div className="text-xs uppercase tracking-[0.08em] text-mute">Website now</div>
        <div className="mt-2 font-mono text-3xl font-medium text-ink">{site?.status ?? "-"}</div>
        <div className="mt-1 text-xs text-mute">
          {site?.maintenance ? "maintenance page" : site?.phpVersion ? `PHP ${site.phpVersion}` : ""} · {serving}/{state.services.length} services serving
        </div>
      </div>
      <div className={`${card} p-6 md:col-span-3`}>
        <div className="text-xs uppercase tracking-[0.08em] text-mute">Danger scores</div>
        <ul className="mt-3 divide-y divide-line">
          {view.scores.map((s) => (
            <li key={s.service} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-ink">{s.service}</span>
              <span className="flex items-center gap-3">
                <Tag tone={s.tone}>{s.bandLabel}</Tag>
                <span className={`w-8 text-right font-mono ${s.tone === "muted" ? "text-mute" : PASTEL[s.tone].text}`}>{s.score}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className={`${card} p-6 md:col-span-3`}>
        <div className="text-xs uppercase tracking-[0.08em] text-mute">Actions</div>
        <ul className="mt-3 space-y-2.5 text-sm">
          {view.pullRequests.map((pr) => (
            <li key={pr.url} className="flex items-center gap-2">
              <GitPullRequest size={15} weight="bold" className="text-pale-green-ink" />
              <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                {pr.label}
              </a>
              <span className="truncate text-mute">{pr.title}</span>
            </li>
          ))}
          {view.alerts.map((a) => (
            <li key={a.id} className="flex items-center gap-2">
              <Bell size={15} weight="bold" className={a.urgent ? "text-pale-red-ink" : "text-pale-blue-ink"} />
              <span className="truncate text-ink-soft">{a.title}</span>
            </li>
          ))}
          {view.pullRequests.length === 0 && view.alerts.length === 0 && <li className="text-mute">No actions recorded.</li>}
        </ul>
      </div>
    </div>
  );
}
