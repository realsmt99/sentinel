"use client";

import { useActions } from "@/hooks/use-actions";
import { usePolling } from "@/hooks/use-polling";
import { buildActionControls, type ActionControl, type ActionControls } from "@/lib/actions";
import { buildFunnel } from "@/lib/funnel";
import { buildHeadline } from "@/lib/headline";
import { buildHealthItems, buildLiveStatus } from "@/lib/health";
import { buildIncidentGroups } from "@/lib/incidents";
import { buildLaneGroups } from "@/lib/lanes";
import { buildServiceViews } from "@/lib/services";
import { buildTrace } from "@/lib/trace";
import type { DashboardState, HealthResponse, StateResponse } from "@/lib/types";
import { AgentLanes } from "./agent-lanes";
import { AgentTrace } from "./agent-trace";
import { FeedFunnel } from "./feed-funnel";
import { Header } from "./header";
import { Hero } from "./hero";
import { IncidentDetail } from "./incident-detail";
import { ServiceGrid } from "./service-cards";
import { ApiUnreachable, DbNotConfigured, DbUnavailable, LoadingState, NoSystemConnected, StaleBanner } from "./setup-states";

const STATE_POLL_MS = 1_000;
const HEALTH_POLL_MS = 5_000;

const isStateOk = (body: StateResponse) => body.ok;
const acceptAll = () => true;

export function Dashboard() {
  const state = usePolling<StateResponse>("/api/state", STATE_POLL_MS, isStateOk);
  const health = usePolling<HealthResponse>("/api/health", HEALTH_POLL_MS, acceptAll);
  const { phases, run } = useActions(state.refresh);

  const lastGood = state.lastGood;
  const snapshot = lastGood?.ok ? lastGood : null;
  const latest = state.latest;
  const problem = latest && !latest.ok ? latest : null;
  const failureText = problem?.message ?? state.error;
  const nowMs = state.checkedAt;
  // Elapsed times compare DB timestamps, so shift the browser clock onto the database clock.
  const dbNowMs = snapshot ? nowMs + (Date.parse(snapshot.dbNow) - state.receivedAt) : nowMs;

  const live = buildLiveStatus({ hasSnapshot: snapshot !== null, failing: failureText !== null, ageMs: nowMs - state.receivedAt });
  const healthItems = buildHealthItems(health.latest, {
    ok: failureText !== null ? false : snapshot ? true : null,
    detail: failureText ?? (snapshot ? "connected" : "checking..."),
  });

  const onRun = (control: ActionControl) => void run(control.button.name, control.button.service);

  let body;
  if (snapshot) {
    const controls = buildActionControls(snapshot, phases, nowMs, dbNowMs);
    body = (
      <>
        {failureText && <StaleBanner text={`Live updates failing (${failureText}). Showing the last good snapshot.`} />}
        {snapshot.services.length === 0 ? (
          <NoSystemConnected connect={controls.connect} onRun={onRun} />
        ) : (
          <Overview snapshot={snapshot} controls={controls} dbNowMs={dbNowMs} onRun={onRun} />
        )}
      </>
    );
  } else if (problem?.reason === "not_configured") {
    body = <DbNotConfigured message={problem.message} />;
  } else if (problem) {
    body = <DbUnavailable problem={problem} />;
  } else if (state.error) {
    body = <ApiUnreachable error={state.error} />;
  } else {
    body = <LoadingState />;
  }

  return (
    <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-5 px-4 pb-20 pt-3 md:px-6">
      <Header live={live} health={healthItems} />
      {body}
    </div>
  );
}

interface OverviewProps {
  snapshot: DashboardState;
  controls: ActionControls;
  dbNowMs: number;
  onRun: (control: ActionControl) => void;
}

function Overview({ snapshot, controls, dbNowMs, onRun }: OverviewProps) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-12">
        <Hero headline={buildHeadline(snapshot, dbNowMs)} controls={controls} onRun={onRun} index={1} className="lg:col-span-7" />
        <FeedFunnel view={buildFunnel(snapshot, dbNowMs)} index={2} className="lg:col-span-5" />
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <AgentLanes groups={buildLaneGroups(snapshot, dbNowMs)} index={3} />
          <ServiceGrid services={buildServiceViews(snapshot)} restoreControls={controls.restoreByService} onRun={onRun} index={4} />
          <IncidentDetail groups={buildIncidentGroups(snapshot)} index={5} />
        </div>
        <AgentTrace
          lines={buildTrace(snapshot.log)}
          index={3}
          className="h-[560px] lg:sticky lg:top-24 lg:col-span-4 lg:h-[calc(100dvh-7.5rem)]"
        />
      </div>
    </div>
  );
}
