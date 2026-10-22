"use client";

import Link from "next/link";
import { useState } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp, Play, SquaresFour } from "@phosphor-icons/react";
import { useActions } from "@/hooks/use-actions";
import { usePolling } from "@/hooks/use-polling";
import { buildActionControls, type ActionControl } from "@/lib/actions";
import { buildLiveStatus } from "@/lib/health";
import { laneLabel } from "@/lib/labels";
import { buildTrace } from "@/lib/trace";
import type { DashboardState, SiteCheck, StateResponse } from "@/lib/types";
import { buildWorkflow, type StepStatus, type WorkflowView } from "@/lib/workflow";
import { ActionButtonView } from "../action-bar";
import { ApiUnreachable, DbNotConfigured, DbUnavailable, StaleBanner } from "../setup-states";
import { LogoMark } from "../ui/logo";
import { Terminal } from "../workflow/terminal";
import type { ConnectionValues } from "./connect-form";
import { SCENES, SceneVisual, sceneCopy, sceneStatus, type SceneContext } from "./scenes";
import { Tag } from "./tag";
import { useSceneQueue } from "./use-scene-queue";

const STATE_POLL_MS = 1_000;
const SITE_POLL_MS = 2_000;
const isStateOk = (body: StateResponse) => body.ok;
const acceptAll = () => true;

/** The scene the live run is on: the first active step, or the summary once everything finished. */
function liveTarget(view: WorkflowView): number {
  if (view.current) return SCENES.findIndex((s) => s.key === view.current);
  return view.feed.total > 0 ? SCENES.length - 1 : 0;
}

export function Stage() {
  const state = usePolling<StateResponse>("/api/state", STATE_POLL_MS, isStateOk);
  const site = usePolling<SiteCheck>("/api/site", SITE_POLL_MS, acceptAll);
  const { phases, run } = useActions(state.refresh);

  const snapshot = state.lastGood?.ok ? state.lastGood : null;
  const problem = state.latest && !state.latest.ok ? state.latest : null;
  const failureText = problem?.message ?? state.error;
  const nowMs = state.checkedAt;
  const dbNowMs = snapshot ? nowMs + (Date.parse(snapshot.dbNow) - state.receivedAt) : nowMs;
  const live = buildLiveStatus({ hasSnapshot: snapshot !== null, failing: failureText !== null, ageMs: nowMs - state.receivedAt });
  const onRun = (control: ActionControl) => void run(control.button.name, control.button.service);
  const connectWith = (values: ConnectionValues) => void run("connect", null, values);

  return (
    <div className="min-h-[100dvh] bg-bone-100 text-ink">
      {snapshot ? (
        <StageBody
          snapshot={snapshot}
          site={site.latest}
          controls={buildActionControls(snapshot, phases, nowMs, dbNowMs)}
          dbNowMs={dbNowMs}
          onRun={onRun}
          connectWith={connectWith}
          live={live}
          failureText={failureText}
        />
      ) : (
        <div className="mx-auto max-w-3xl px-6 py-16">
          {problem?.reason === "not_configured" ? (
            <DbNotConfigured message={problem.message} />
          ) : problem ? (
            <DbUnavailable problem={problem} />
          ) : state.error ? (
            <ApiUnreachable error={state.error} />
          ) : (
            <p className="text-sm text-mute">Loading Guard...</p>
          )}
        </div>
      )}
    </div>
  );
}

interface StageBodyProps {
  snapshot: DashboardState;
  site: SiteCheck | null;
  controls: ReturnType<typeof buildActionControls>;
  dbNowMs: number;
  onRun: (control: ActionControl) => void;
  connectWith: (values: ConnectionValues) => void;
  live: ReturnType<typeof buildLiveStatus>;
  failureText: string | null;
}

function StageBody({ snapshot, site, controls, dbNowMs, onRun, connectWith, live, failureText }: StageBodyProps) {
  const view = buildWorkflow(snapshot, dbNowMs);
  const statuses: StepStatus[] = SCENES.map((s) => sceneStatus(s.key, view));
  const target = liveTarget(view);
  const followed = useSceneQueue(
    target,
    statuses.map((status) => status === "skipped"),
  );
  const [pinned, setPinned] = useState<number | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const shown = pinned ?? followed;
  const scene = SCENES[shown];

  const restore = controls.restoreByService[view.offline?.service ?? ""] ?? controls.restore;
  const ctx: SceneContext = {
    view,
    state: snapshot,
    site,
    controls: { connect: controls.connect, replay: controls.replay, restore },
    onRun,
    connectWith,
    nowMs: dbNowMs,
  };
  const copy = sceneCopy(scene.key, ctx);
  const status = statuses[shown];
  const go = (index: number) => setPinned(Math.max(0, Math.min(SCENES.length - 1, index)));
  const lastLine = snapshot.log[snapshot.log.length - 1] ?? null;

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-bone-100/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3 md:px-10">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-6" ink />
            <span className="text-[15px] font-semibold tracking-tight">Guard</span>
            <Tag tone={live.tone === "success" ? "success" : live.tone === "danger" ? "danger" : "muted"} pulse={live.pulse}>
              {live.label}
            </Tag>
          </div>
          <nav aria-label="Steps" className="order-3 w-full md:order-none md:w-auto md:flex-1">
            <ol className="grid grid-cols-9 gap-1.5">
              {SCENES.map((s, i) => (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className="group block w-full rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                    aria-current={i === shown ? "step" : undefined}
                  >
                    <span
                      className={`block h-1 rounded-full transition-colors duration-500 ease-out-expo ${
                        statuses[i] === "done"
                          ? "bg-ink"
                          : statuses[i] === "active"
                            ? "animate-breathe bg-ink/50"
                            : statuses[i] === "skipped"
                              ? "bg-line"
                              : "bg-bone-200"
                      } ${i === shown ? "outline outline-2 outline-offset-2 outline-ink/20" : ""}`}
                    />
                    <span
                      className={`mt-1.5 hidden truncate text-[10.5px] lg:block ${i === shown ? "font-medium text-ink" : "text-mute group-hover:text-ink-soft"}`}
                    >
                      {s.short}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => go(shown - 1)} disabled={shown === 0} className="flex size-8 items-center justify-center rounded-md border border-line bg-white text-ink-soft transition-[transform,opacity] duration-200 hover:bg-bone-50 active:scale-[0.96] disabled:opacity-40" aria-label="Previous step">
              <CaretLeft size={14} weight="bold" />
            </button>
            <button type="button" onClick={() => go(shown + 1)} disabled={shown === SCENES.length - 1} className="flex size-8 items-center justify-center rounded-md border border-line bg-white text-ink-soft transition-[transform,opacity] duration-200 hover:bg-bone-50 active:scale-[0.96] disabled:opacity-40" aria-label="Next step">
              <CaretRight size={14} weight="bold" />
            </button>
            {pinned !== null && (
              <button type="button" onClick={() => setPinned(null)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-ink px-3 text-xs font-medium text-white transition-colors duration-200 hover:bg-[#333333]">
                <Play size={11} weight="fill" />
                Follow live
              </button>
            )}
            <Link href="/details" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-xs text-ink-soft transition-colors duration-200 hover:bg-bone-50">
              <SquaresFour size={13} weight="bold" />
              Details
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-40 pt-12 md:px-10 md:pt-16">
        {failureText && (
          <div className="mb-8">
            <StaleBanner text={`Live updates failing (${failureText}). Showing the last good snapshot.`} />
          </div>
        )}
        <section key={scene.key} className={`grid animate-scene-in items-start gap-12 ${scene.key === "summary" ? "" : "lg:grid-cols-12"}`}>
          <div className={scene.key === "summary" ? "max-w-3xl" : "lg:col-span-5 lg:pt-6"}>
            <div className="flex items-center gap-3 text-xs text-mute">
              <span className="font-mono">
                {scene.key === "summary" ? "Summary" : `Step ${String(shown + 1).padStart(2, "0")} / 08`}
              </span>
              <StatusTag status={status} needsHuman={copy.cta !== undefined} />
            </div>
            <h1 className="mt-5 font-serif text-5xl leading-[1.05] tracking-[-0.02em] text-ink md:text-6xl">{copy.headline}</h1>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-[1.7] text-ink-soft">{copy.summary}</p>
            {copy.activity && (
              <p key={copy.activity} className="mt-6 flex max-w-[52ch] animate-line-in items-start gap-2.5 rounded-lg border border-line bg-white px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-ink-soft">
                <span className="mt-[6px] inline-block size-1.5 shrink-0 animate-breathe rounded-full bg-pale-blue-ink" />
                <span className="min-w-0 break-words">{copy.activity}</span>
              </p>
            )}
            {copy.cta && <div className="mt-8">{copy.cta}</div>}
          </div>
          <div className={scene.key === "summary" ? "" : "min-w-0 lg:col-span-7"}>
            <SceneVisual sceneKey={scene.key} ctx={ctx} />
          </div>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/90 backdrop-blur-md">
        {logOpen && (
          <div className="mx-auto max-w-6xl animate-rise px-6 pt-4 md:px-10">
            <div className="h-[300px]">
              <Terminal lines={buildTrace(snapshot.log)} busy={view.current !== null} />
            </div>
          </div>
        )}
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3 md:px-10">
          <span className="flex shrink-0 items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            <span className={`size-1.5 rounded-full ${view.current ? "animate-breathe bg-pale-blue-ink" : "bg-line"}`} />
            Agents
          </span>
          <p key={lastLine?.id ?? 0} className="min-w-0 flex-1 animate-line-in truncate font-mono text-[12px] text-ink-soft">
            {lastLine ? (
              <>
                <span className="text-mute">{laneLabel(lastLine.agent, lastLine.service)} </span>
                {lastLine.message}
              </>
            ) : (
              <span className="text-mute">Waiting for the first step</span>
            )}
          </p>
          <ActionButtonView control={controls.reset} onRun={onRun} compact theme="light" />
          <button
            type="button"
            onClick={() => setLogOpen((open) => !open)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-soft transition-colors duration-200 hover:bg-bone-50"
          >
            {logOpen ? <CaretDown size={12} weight="bold" /> : <CaretUp size={12} weight="bold" />}
            Agent log
          </button>
        </div>
      </footer>
    </>
  );
}

function StatusTag({ status, needsHuman }: { status: StepStatus; needsHuman: boolean }) {
  if (status === "active") return <Tag tone={needsHuman ? "warning" : "info"} pulse>{needsHuman ? "Your turn" : "In progress"}</Tag>;
  if (status === "done") return <Tag tone="success">Done</Tag>;
  if (status === "skipped") return <Tag tone="muted">Not needed</Tag>;
  return <Tag tone="muted">Waiting</Tag>;
}
