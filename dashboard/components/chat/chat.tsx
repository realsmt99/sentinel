"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft } from "@phosphor-icons/react";
import { useActions } from "@/hooks/use-actions";
import { usePolling } from "@/hooks/use-polling";
import { buildActionControls, type ActionControl, type ActionControls } from "@/lib/actions";
import { buildLiveStatus } from "@/lib/health";
import type { DashboardState, HistoryDoc, HistoryEntry, SiteCheck, StateResponse } from "@/lib/types";
import { buildWorkflow } from "@/lib/workflow";
import { ActionButtonView } from "../action-bar";
import { ApiUnreachable, DbNotConfigured, DbUnavailable, StaleBanner } from "../setup-states";
import type { ConnectionValues } from "../stage/connect-form";
import type { SceneContext } from "../stage/scenes";
import { SceneVisual } from "../stage/scenes";
import { Tag } from "../stage/tag";
import { ChatCardView } from "./cards";
import { GuardAvatar, Message } from "./message";
import { Sidebar } from "./sidebar";
import { Thinking, currentActivity } from "./thinking";

const STATE_POLL_MS = 1_000;
const SITE_POLL_MS = 2_000;
const HISTORY_POLL_MS = 5_000;
const FOLLOW_THRESHOLD_PX = 80;
const isStateOk = (body: StateResponse) => body.ok;
const acceptAll = () => true;

type HistoryList = { ok: boolean; runs?: HistoryEntry[] };

function fromHistory(doc: HistoryDoc): DashboardState {
  return {
    ok: true,
    ...doc.state,
    chat: doc.state.chat ?? [],
    run: { id: doc.id, title: doc.title, status: "archived", outcome: doc.outcome, started_at: doc.startedAt },
  };
}

export function Chat() {
  const state = usePolling<StateResponse>("/api/state", STATE_POLL_MS, isStateOk);
  const site = usePolling<SiteCheck>("/api/site", SITE_POLL_MS, acceptAll);
  const history = usePolling<HistoryList>("/api/history", HISTORY_POLL_MS, acceptAll);
  const { phases, run } = useActions(state.refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const [archived, setArchived] = useState<HistoryDoc | null>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/history/${selected}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { ok: boolean; run?: HistoryDoc }) => !cancelled && setArchived(body.ok && body.run ? body.run : null))
      .catch(() => !cancelled && setArchived(null));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const live = state.lastGood?.ok ? state.lastGood : null;
  const problem = state.latest && !state.latest.ok ? state.latest : null;
  const failureText = problem?.message ?? state.error;
  const nowMs = state.checkedAt;
  const dbNowMs = live ? nowMs + (Date.parse(live.dbNow) - state.receivedAt) : nowMs;
  const status = buildLiveStatus({ hasSnapshot: live !== null, failing: failureText !== null, ageMs: nowMs - state.receivedAt });
  const onRun = (control: ActionControl) => void run(control.button.name, control.button.service);
  const connectWith = (values: ConnectionValues) => void run("connect", null, values);
  const select = (id: string | null) => {
    setSelected(id);
    if (id === null) setArchived(null);
  };

  const viewing = selected && archived?.id === selected ? fromHistory(archived) : null;
  const liveControls = live ? buildActionControls(live, phases, nowMs, dbNowMs) : null;

  let main;
  if (viewing) {
    main = <Conversation key={`saved:${viewing.run?.id}`} state={viewing} site={null} controls={buildActionControls(viewing, {}, nowMs, Date.parse(viewing.dbNow))} nowMs={Date.parse(viewing.dbNow)} onRun={onRun} connectWith={connectWith} readOnly onBack={() => select(null)} />;
  } else if (selected) {
    main = <p className="m-auto text-sm text-mute">Opening the saved run...</p>;
  } else if (live && liveControls) {
    main = (
      <Conversation
        key={`live:${live.run?.id ?? "none"}`}
        state={live}
        site={site.latest}
        controls={liveControls}
        nowMs={dbNowMs}
        onRun={onRun}
        connectWith={connectWith}
        readOnly={false}
        banner={failureText ? `Live updates failing (${failureText}). Showing the last good snapshot.` : null}
        status={status}
      />
    );
  } else if (problem?.reason === "not_configured") {
    main = <div className="mx-auto max-w-3xl p-8"><DbNotConfigured message={problem.message} /></div>;
  } else if (problem) {
    main = <div className="mx-auto max-w-3xl p-8"><DbUnavailable problem={problem} /></div>;
  } else if (state.error) {
    main = <div className="mx-auto max-w-3xl p-8"><ApiUnreachable error={state.error} /></div>;
  } else {
    main = <p className="m-auto text-sm text-mute">Loading Guard...</p>;
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-bone-100 text-ink">
      <Sidebar
        liveRun={live?.run ?? null}
        history={history.latest?.runs ?? []}
        selected={selected}
        onSelect={select}
        controls={liveControls}
        onRun={onRun}
      />
      <main className="flex min-w-0 flex-1 flex-col">{main}</main>
    </div>
  );
}

interface ConversationProps {
  state: DashboardState;
  site: SiteCheck | null;
  controls: ActionControls;
  nowMs: number;
  onRun: (control: ActionControl) => void;
  connectWith: (values: ConnectionValues) => void;
  readOnly: boolean;
  onBack?: () => void;
  banner?: string | null;
  status?: ReturnType<typeof buildLiveStatus>;
}

function Conversation({ state, site, controls, nowMs, onRun, connectWith, readOnly, onBack, banner, status }: ConversationProps) {
  const view = buildWorkflow(state, nowMs);
  const restore = controls.restoreByService[view.offline?.service ?? ""] ?? controls.restore;
  const ctx: SceneContext = {
    view,
    state,
    site,
    controls: { connect: controls.connect, replay: controls.replay, restore },
    onRun,
    connectWith,
    nowMs,
  };
  const activity = readOnly ? null : currentActivity(state, view.feed.streaming);
  const connected = state.services.length > 0;

  // Messages already present when this conversation opens appear at once; later ones are typed out.
  const [firstSeen] = useState(() => (readOnly ? Infinity : Math.max(0, ...state.chat.map((m) => m.id))));
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);

  // Typing and cards grow the content after each message, so stay pinned to the bottom on every resize.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver(() => {
      if (followRef.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Only the reader scrolling up stops following; programmatic scrolls never do.
  const stopFollowing = () => {
    const el = scrollRef.current;
    if (!el || el.scrollHeight - el.scrollTop - el.clientHeight < 2) return;
    followRef.current = false;
    setFollowing(false);
  };
  const onScroll = () => {
    const el = scrollRef.current;
    if (el && !followRef.current && el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX) {
      followRef.current = true;
      setFollowing(true);
    }
  };
  const jump = () => {
    followRef.current = true;
    setFollowing(true);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const run = state.run;
  return (
    <>
      <header className="flex items-center justify-between gap-4 border-b border-line bg-bone-100/90 px-6 py-3 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-3">
          {readOnly && onBack && (
            <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-2.5 py-1 text-xs text-ink-soft transition-colors duration-200 hover:bg-bone-50">
              <ArrowLeft size={12} weight="bold" />
              Back to live
            </button>
          )}
          <span className="truncate text-sm font-medium text-ink">{run?.title ?? "Guard"}</span>
          {readOnly ? <Tag tone="muted">Saved run</Tag> : status && <Tag tone={status.tone === "success" ? "success" : status.tone === "danger" ? "danger" : "muted"} pulse={status.pulse}>{status.label}</Tag>}
        </div>
        {run && <span className="hidden font-mono text-[11px] text-mute sm:block">{run.id}</span>}
      </header>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={(e) => e.deltaY < 0 && stopFollowing()}
        onTouchMove={stopFollowing}
        onKeyDown={(e) => ["ArrowUp", "PageUp", "Home"].includes(e.key) && stopFollowing()}
        className="thin-scroll relative min-h-0 flex-1 overflow-y-auto"
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-7 px-6 pb-16 pt-10">
          {banner && <StaleBanner text={banner} />}
          {!readOnly && !connected && (
            <div className="flex animate-rise gap-3.5">
              <GuardAvatar />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-sm font-semibold text-ink">Guard</div>
                <p className="mt-1 text-[15px] leading-[1.7] text-ink-soft">
                  Hi, I&apos;m Guard. Connect your project and I&apos;ll watch it for new vulnerabilities: your Aiven database, GitHub
                  repository, Docker project, website and phone are already filled in. Test them, then connect.
                </p>
                <div className="mt-4">
                  <SceneVisual sceneKey="connect" ctx={ctx} />
                </div>
              </div>
            </div>
          )}
          {state.chat.map((message) => (
            <Message
              key={message.id}
              message={message}
              animate={message.id > firstSeen}
              card={message.card ? <ChatCardView card={message.card} ctx={ctx} readOnly={readOnly} /> : null}
            />
          ))}
          {activity && <Thinking text={activity} />}
        </div>
        {!following && (
          <button
            type="button"
            onClick={jump}
            className="sticky bottom-4 left-1/2 mx-auto flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-xs text-ink-soft shadow-[0_2px_8px_rgba(17,17,17,0.06)]"
          >
            <ArrowDown size={12} weight="bold" />
            Jump to latest
          </button>
        )}
      </div>

      {!readOnly && connected && <Composer ctx={ctx} controls={controls} onRun={onRun} activity={activity} />}
    </>
  );
}

function Composer({ ctx, controls, onRun, activity }: { ctx: SceneContext; controls: ActionControls; onRun: (c: ActionControl) => void; activity: string | null }) {
  const { view } = ctx;
  const replayReady = view.feed.total === 0;
  const restoreReady = view.steps.restore === "active";
  const hint = activity
    ? "Guard is working. Every step appears above as it happens."
    : replayReady
      ? "Next: replay the real NVD feed of 21 October 2026."
      : restoreReady
        ? "Waiting for you: merge the fix on GitHub, or approve the restore."
        : view.current === null
          ? "This run is complete. Start a new run or disconnect from the sidebar."
          : "Guard is waiting for the next step.";
  return (
    <div className="border-t border-line bg-bone-100 px-6 py-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_1px_2px_rgba(17,17,17,0.03)]">
        <span className="text-sm text-mute">{hint}</span>
        <span className="flex flex-wrap gap-2">
          {replayReady && <ActionButtonView control={controls.replay} onRun={onRun} compact theme="light" />}
          {restoreReady && <ActionButtonView control={ctx.controls.restore} onRun={onRun} compact theme="light" />}
        </span>
      </div>
    </div>
  );
}
