"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  ChatCircleText,
  CheckCircle,
  Circle,
  GithubLogo,
  Globe,
  MinusCircle,
  ShieldCheck,
  WarningOctagon,
} from "@phosphor-icons/react";
import { useActions } from "@/hooks/use-actions";
import { usePolling } from "@/hooks/use-polling";
import { actionKey, buildActionControls, type ActionControl } from "@/lib/actions";
import { formatClock, formatCount } from "@/lib/format";
import { logLevelTone, runtimeLabel, serviceStatus } from "@/lib/labels";
import type { DashboardState, SiteCheck, StateResponse } from "@/lib/types";
import { buildWorkflow, type StepKey, type StepStatus, type WorkflowView } from "@/lib/workflow";
import { ActionButtonView } from "../action-bar";
import { ApiUnreachable, DbNotConfigured, DbUnavailable } from "../setup-states";
import { ConnectForm, type ConnectionValues } from "../stage/connect-form";
import { PASTEL, Tag } from "../stage/tag";
import { Button } from "../ui/button";
import { LogoMark } from "../ui/logo";

const STATE_POLL_MS = 1_000;
const SITE_POLL_MS = 2_000;
const LOG_LINES = 14;
const isStateOk = (body: StateResponse) => body.ok;
const acceptAll = () => true;

const STEPS: { key: StepKey; title: string }[] = [
  { key: "connect", title: "Connected to your project" },
  { key: "feed", title: "Reading the CVE feed" },
  { key: "research", title: "Researching the threat" },
  { key: "score", title: "Scoring the danger of each service" },
  { key: "offline", title: "Protecting the website" },
  { key: "prs", title: "Opening fix pull requests" },
  { key: "phone", title: "Alerting your phone" },
  { key: "restore", title: "Back online on the patched version" },
];

/** Connect, then everything runs on its own: the page only reports, links to the PRs and can restore the app. */
export function AutoDashboard() {
  const state = usePolling<StateResponse>("/api/state", STATE_POLL_MS, isStateOk);
  const site = usePolling<SiteCheck>("/api/site", SITE_POLL_MS, acceptAll);
  const { phases, run } = useActions(state.refresh);

  const live = state.lastGood?.ok ? state.lastGood : null;
  const problem = state.latest && !state.latest.ok ? state.latest : null;
  const nowMs = state.checkedAt;
  const dbNowMs = live ? nowMs + (Date.parse(live.dbNow) - state.receivedAt) : nowMs;

  // Nothing starts until Connect is pressed: services left in the database from an earlier session
  // still show the form, until the feed is running or this page's Connect was accepted.
  const connectPhase = phases[actionKey("connect")];
  const resetPhase = phases[actionKey("reset")];
  const connectAccepted = connectPhase?.kind === "waiting" && connectPhase.at > (resetPhase?.at ?? 0);
  const started = live !== null && live.services.length > 0 && (live.funnel.total > 0 || connectAccepted);

  const view = live && started ? buildWorkflow(live, dbNowMs) : null;
  const controls = live ? buildActionControls(live, phases, nowMs, dbNowMs) : null;
  let main: ReactNode;
  if (live && controls) {
    if (!view) {
      main = <Onboarding control={controls.connect} onConnect={(values) => void run("connect", null, { ...values, autopilot: true })} />;
    } else {
      const restore = controls.restoreByService[view.offline?.service ?? ""] ?? controls.restore;
      main = <Monitor state={live} view={view} site={site.latest} restore={restore} onRun={(c) => void run(c.button.name, c.button.service)} />;
    }
  } else if (problem?.reason === "not_configured") {
    main = <DbNotConfigured message={problem.message} />;
  } else if (problem) {
    main = <DbUnavailable problem={problem} />;
  } else if (state.error) {
    main = <ApiUnreachable error={state.error} />;
  } else {
    main = <div className="skeleton h-[420px] rounded-xl" />;
  }

  return (
    <div className="min-h-[100dvh] bg-bone-100 text-ink">
      <header className="border-b border-line bg-bone-100/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-6" ink />
            <span className="text-sm font-semibold">Guard</span>
            {view && <AutopilotTag current={view.current} />}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/chat" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-mute transition-colors duration-200 hover:bg-bone-200 hover:text-ink">
              <ChatCircleText size={13} weight="bold" />
              Conversation view
            </Link>
            {view && controls && <ActionButtonView control={controls.reset} onRun={(c) => void run(c.button.name)} compact theme="light" />}
          </div>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">{main}</main>
    </div>
  );
}

function AutopilotTag({ current }: { current: StepKey | null }) {
  if (current === null) return <Tag tone="success">Autopilot idle</Tag>;
  if (current === "restore") return <Tag tone="warning">Waiting for your merge</Tag>;
  return (
    <Tag tone="info" pulse>
      Autopilot working
    </Tag>
  );
}

function Onboarding({ control, onConnect }: { control: ActionControl; onConnect: (values: ConnectionValues) => void }) {
  const connect = { ...control, button: { ...control.button, label: "Connect and start", busyLabel: "Connecting..." } };
  return (
    <>
      <div className="animate-rise">
        <h1 className="text-2xl font-semibold tracking-tight">Connect your service. Guard does the rest.</h1>
        <p className="mt-2 max-w-[65ch] text-[15px] leading-relaxed text-ink-soft">
          Check your credentials below and press Connect. Guard then fetches the CVE feed, scores every service, takes the website
          offline if it has to, opens the fix pull requests and alerts your phone, all on its own. You only watch this page.
        </p>
      </div>
      <ConnectForm control={connect} onConnect={onConnect} />
    </>
  );
}

interface MonitorProps {
  state: DashboardState;
  view: WorkflowView;
  site: SiteCheck | null;
  restore: ActionControl;
  onRun: (control: ActionControl) => void;
}

function Monitor({ state, view, site, restore, onRun }: MonitorProps) {
  return (
    <>
      <SiteHero view={view} site={site} restore={restore} onRun={onRun} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="What Guard is doing" aside={view.current ? "updates live" : "finished"}>
          <Steps view={view} />
        </Card>
        <div className="flex flex-col gap-5">
          <PullRequests view={view} />
          <Services view={view} />
        </div>
      </div>
      <Activity state={state} />
    </>
  );
}

function SiteHero({ view, site, restore, onRun }: { view: WorkflowView; site: SiteCheck | null; restore: ActionControl; onRun: (control: ActionControl) => void }) {
  const { state: siteState, service, version, url } = view.site;
  const offline = siteState === "offline" || site?.maintenance === true;
  const restoring = siteState === "restoring" || restore.busy;
  const tone = restoring ? "info" : offline ? "danger" : "success";
  const p = PASTEL[tone];

  let title: string;
  let detail: string;
  if (restoring) {
    title = "Bringing your website back";
    detail = `Recreating ${service} on the patched image, checking its version and health.`;
  } else if (offline) {
    title = "Your website is offline, on purpose";
    detail = view.offline
      ? `${service} scored ${view.offline.score}/100 against ${view.feed.cveIds.join(", ") || "a critical CVE"}, so Guard put it behind the maintenance page.`
      : `${service} is behind the maintenance page.`;
  } else {
    title = view.restoredVersion ? "Your website is back online and patched" : "Your website is online";
    detail = view.current ? "Guard is watching it while the autopilot works." : "Nothing needs your attention.";
  }

  const live = site?.status != null ? `HTTP ${site.status} · ${site.ms} ms` : site?.error ? "not reachable" : "checking...";
  const php = site?.phpVersion ?? version;
  return (
    <section className={`animate-rise rounded-xl border border-line p-6 ${p.bg}`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className={`mt-0.5 ${p.text}`}>
            {offline && !restoring ? <WarningOctagon size={26} weight="fill" /> : <ShieldCheck size={26} weight="fill" />}
          </span>
          <div className="min-w-0">
            <h1 className={`text-xl font-semibold tracking-tight ${p.text}`}>{title}</h1>
            <p className="mt-1 max-w-[62ch] text-sm leading-relaxed text-ink-soft">{detail}</p>
            <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-mute">
              <span>{live}</span>
              {php && <span>PHP {php}</span>}
              <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
                <Globe size={11} weight="bold" />
                Open website
              </a>
            </p>
          </div>
        </div>
        {(offline || restoring) && (
          <div className="flex flex-col items-end gap-1.5">
            <Button theme="light" variant="primary" busy={restore.busy} disabled={restore.disabled} icon={<ArrowCounterClockwise size={14} weight="bold" />} onClick={() => onRun(restore)}>
              {restore.busy ? restore.button.busyLabel : "Bring the app back online"}
            </Button>
            <span className="max-w-[34ch] text-right text-[11px] leading-snug text-mute">
              {restore.message?.text ?? "Or merge the fix PR on GitHub: Guard redeploys it automatically."}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

function Card({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="animate-rise rounded-xl border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        {aside && <span className="font-mono text-[11px] text-mute">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function stepDetail(key: StepKey, status: StepStatus, view: WorkflowView): string | null {
  if (status === "skipped") return "Not needed";
  if (status === "waiting") return null;
  switch (key) {
    case "connect":
      return view.services.map((s) => s.name).join(", ");
    case "feed":
      return view.feed.total === 0
        ? "Starting automatically..."
        : `${formatCount(view.feed.total)} CVEs received, ${view.feed.matched} affect your stack`;
    case "offline":
      return view.offline ? `${view.offline.service} put behind the maintenance page (score ${view.offline.score})` : null;
    case "prs":
      return view.pullRequests.length ? view.pullRequests.map((pr) => pr.label).join(", ") : view.prsSkippedReason;
    case "restore":
      return status === "done" ? `Running ${view.restoredVersion ? `PHP ${view.restoredVersion}` : "the patched version"}` : "Merge the fix PR, or bring the app back above";
    default:
      return view.activity[key] ?? null;
  }
}

function Steps({ view }: { view: WorkflowView }) {
  return (
    <ol className="divide-y divide-line">
      {STEPS.map(({ key, title }) => {
        const status = view.steps[key];
        const detail = stepDetail(key, status, view);
        return (
          <li key={key} className={`flex items-start gap-3 px-5 py-3 ${status === "waiting" ? "opacity-50" : ""}`}>
            <StepIcon status={status} />
            <div className="min-w-0">
              <div className={`text-sm ${status === "active" ? "font-medium text-ink" : "text-ink-soft"}`}>{title}</div>
              {detail && <div className="mt-0.5 line-clamp-2 break-words text-[12px] leading-snug text-mute">{detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "done") return <CheckCircle size={18} weight="fill" className="mt-px shrink-0 text-pale-green-ink" />;
  if (status === "skipped") return <MinusCircle size={18} className="mt-px shrink-0 text-mute" />;
  if (status === "waiting") return <Circle size={18} className="mt-px shrink-0 text-mute" />;
  return (
    <span className="relative mt-[3px] flex size-3.5 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-ping-soft rounded-full bg-pale-blue-ink/40" />
      <span className="size-2.5 rounded-full bg-pale-blue-ink" />
    </span>
  );
}

function PullRequests({ view }: { view: WorkflowView }) {
  const status = view.steps.prs;
  const empty =
    view.prsSkippedReason ??
    (status === "skipped" ? "No service needs a fix." : status === "active" ? "Preparing the fixes..." : "Fix pull requests will appear here.");
  return (
    <Card title="Fix pull requests" aside={view.pullRequests.length ? `${view.pullRequests.length} open` : undefined}>
      {view.pullRequests.length === 0 ? (
        <p className="px-5 py-4 text-sm text-mute">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {view.pullRequests.map((pr) => (
            <li key={pr.url}>
              <a href={pr.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 px-5 py-3.5 transition-colors duration-200 hover:bg-bone-50">
                <GithubLogo size={18} weight="fill" className="shrink-0 text-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{pr.title}</span>
                  <span className="block font-mono text-[11px] text-mute">{pr.label} · review and merge on GitHub</span>
                </span>
                <ArrowSquareOut size={14} weight="bold" className="shrink-0 text-mute transition-colors group-hover:text-ink" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Services({ view }: { view: WorkflowView }) {
  return (
    <Card title="Your services">
      <ul className="divide-y divide-line">
        {view.services.map((service) => {
          const score = view.scores.find((s) => s.service === service.name);
          const status = serviceStatus(service.status);
          return (
            <li key={service.name} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{service.name}</span>
                <span className="block font-mono text-[11px] text-mute">
                  {runtimeLabel(service.language, service.runtime_version)} · {service.exposure}
                </span>
              </span>
              {score && score.bandLabel !== "Waiting" && (
                <span className={`font-mono text-xs ${PASTEL[score.tone].text}`} title={score.bandLabel}>
                  {score.score}/100
                </span>
              )}
              <Tag tone={status.tone} pulse={service.status === "RESTORING"}>
                {status.label}
              </Tag>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Activity({ state }: { state: DashboardState }) {
  const lines = state.log.slice(-LOG_LINES).reverse();
  return (
    <Card title="Activity" aside="newest first">
      {lines.length === 0 ? (
        <p className="px-5 py-4 text-sm text-mute">Nothing yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {lines.map((line) => (
            <li key={line.id} className="flex gap-3 px-5 py-2 text-[12px] leading-relaxed">
              <span className="shrink-0 font-mono text-mute">{formatClock(line.ts)}</span>
              <span className={`min-w-0 break-words ${PASTEL[logLevelTone(line.level)].text}`}>{line.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
