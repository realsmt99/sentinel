import type { ReactNode } from "react";
import { Cube, GitPullRequest, ShieldChevron, Stack, WarningCircle } from "@phosphor-icons/react";
import type { ActionControl } from "@/lib/actions";
import type { StateError } from "@/lib/types";
import { ActionButtonView } from "./action-bar";
import { Eyebrow } from "./ui/badge";
import { toneText } from "./ui/tone";

function StateCard({ eyebrow, title, tone = "neutral", children }: { eyebrow: string; title: string; tone?: "neutral" | "danger" | "warning"; children: ReactNode }) {
  const ring = tone === "danger" ? "ring-rose-400/20" : tone === "warning" ? "ring-amber-400/20" : "ring-white/[0.06]";
  return (
    <section className={`reveal mt-6 max-w-3xl rounded-[1.75rem] bg-white/[0.02] p-1.5 ring-1 ${ring}`}>
      <div className="rounded-[calc(1.75rem-0.375rem)] bg-ink-900/80 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.04] md:p-9">
        <Eyebrow icon={tone === "neutral" ? undefined : <WarningCircle size={11} weight="bold" className={tone === "danger" ? "text-rose-300" : "text-amber-300"} />}>
          {eyebrow}
        </Eyebrow>
        <h2 className="mt-4 text-2xl font-medium tracking-tight text-zinc-50">{title}</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-400">{children}</div>
      </div>
    </section>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <pre className="overflow-x-auto rounded-xl bg-black/40 p-4 font-mono text-xs text-zinc-200 ring-1 ring-inset ring-white/5">{children}</pre>;
}

/** Skeleton of the overview grid, so the page does not jump when data arrives. */
export function LoadingState() {
  return (
    <div aria-busy className="flex flex-col gap-5" aria-label="Loading Guard state">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="skeleton h-72 rounded-[1.75rem] lg:col-span-7" />
        <div className="skeleton h-72 rounded-[1.5rem] lg:col-span-5" />
      </div>
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="skeleton h-[28rem] rounded-[1.5rem] lg:col-span-8" />
        <div className="skeleton h-[28rem] rounded-[1.5rem] lg:col-span-4" />
      </div>
    </div>
  );
}

export function DbNotConfigured({ message }: { message: string }) {
  return (
    <StateCard eyebrow="Setup" title="Database not configured" tone="warning">
      <p>{message}</p>
      <p>
        The dashboard reads the same <code className="font-mono text-zinc-200">.env</code> as the agent, at the repository root. Add
        the Aiven service URI (the direct one, not the PgBouncer pool):
      </p>
      <Code>{"DATABASE_URL=postgres://avnadmin:PASSWORD@HOST:PORT/defaultdb?sslmode=require\nAGENT_URL=http://localhost:8000"}</Code>
      <p className="text-zinc-500">The file is re-read every few seconds while DATABASE_URL is missing; no restart needed.</p>
    </StateCard>
  );
}

const PROBLEM_TITLE: Record<Exclude<StateError["reason"], "not_configured">, string> = {
  unreachable: "Cannot reach the database",
  schema_missing: "Database schema missing",
  query_failed: "Dashboard query failed",
};

export function DbUnavailable({ problem }: { problem: StateError }) {
  const title = problem.reason === "not_configured" ? "Database not configured" : PROBLEM_TITLE[problem.reason];
  return (
    <StateCard eyebrow="Database" title={title} tone="danger">
      <p className="break-words">{problem.message}</p>
      {problem.reason === "schema_missing" && <Code>{'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sentinel/db/schema.sql'}</Code>}
      <p className="text-zinc-500">Retrying every second.</p>
    </StateCard>
  );
}

export function ApiUnreachable({ error }: { error: string }) {
  return (
    <StateCard eyebrow="Dashboard" title="Dashboard server not responding" tone="danger">
      <p>
        <code className="font-mono text-zinc-200">/api/state</code> failed: {error}
      </p>
      <p className="text-zinc-500">Is the Next.js server still running? Retrying every second.</p>
    </StateCard>
  );
}

const TOUCH_POINTS = [
  { icon: <Stack size={18} weight="light" />, title: "Container labels", text: "exposure, revenue, repo path; versions are detected live" },
  { icon: <ShieldChevron size={18} weight="light" />, title: "One Nginx include", text: "a maintenance switch Guard can flip per service" },
  { icon: <Cube size={18} weight="light" />, title: "Docker access", text: "to inspect, stop and restore containers" },
  { icon: <GitPullRequest size={18} weight="light" />, title: "A GitHub token", text: "to open fix PRs, never to merge them" },
];

export function NoSystemConnected({ connect, onRun }: { connect: ActionControl; onRun: (control: ActionControl) => void }) {
  return (
    <section className="reveal grid gap-5 rounded-[1.75rem] bg-white/[0.02] p-1.5 ring-1 ring-white/[0.06] lg:grid-cols-12">
      <div className="flex flex-col justify-between gap-10 rounded-[calc(1.75rem-0.375rem)] bg-ink-900/80 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.04] md:p-9 lg:col-span-7">
        <div>
          <Eyebrow>Not connected</Eyebrow>
          <h1 className="mt-5 max-w-[20ch] text-3xl font-medium leading-[1.08] tracking-tighter text-zinc-50 md:text-[2.5rem]">
            Plug Guard into a running system
          </h1>
          <p className="mt-4 max-w-[58ch] text-sm leading-relaxed text-zinc-400">
            Connecting runs the scanner: it reads the <code className="font-mono text-zinc-200">sentinel.*</code> Docker labels,
            checks the live runtime versions inside each container, and stores the inventory in Aiven.
          </p>
        </div>
        <div className="space-y-2">
          <ActionButtonView control={connect} onRun={onRun} />
          {connect.message && <p className={`text-xs ${toneText[connect.message.tone]}`}>{connect.message.text}</p>}
        </div>
      </div>
      <ul className="grid content-center gap-2 p-3 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1 lg:pr-6">
        {TOUCH_POINTS.map((point, i) => (
          <li
            key={point.title}
            style={{ animationDelay: `${(i + 2) * 90}ms` }}
            className="reveal flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors duration-500 ease-spring hover:bg-white/[0.03]"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-signal-300 ring-1 ring-inset ring-white/[0.06]">
              {point.icon}
            </span>
            <div>
              <div className="text-sm font-medium text-zinc-100">{point.title}</div>
              <div className="text-xs leading-relaxed text-zinc-500">{point.text}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function StaleBanner({ text }: { text: string }) {
  return <div className="rounded-2xl bg-amber-400/[0.06] px-4 py-2.5 text-xs text-amber-200 ring-1 ring-inset ring-amber-400/20">{text}</div>;
}
