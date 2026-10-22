import type { ReactNode } from "react";
import { Funnel, GitPullRequest, Gauge, Globe, Robot, ShieldWarning, Timer, Wrench } from "@phosphor-icons/react";
import { formatDuration } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import type { LaneGroup, LaneView } from "@/lib/lanes";
import type { AgentName } from "@/lib/types";
import { Badge, StatusDot } from "./ui/badge";
import { ExternalLink } from "./ui/external-link";
import { Panel } from "./ui/panel";
import { toneBorder, toneSurface, toneText } from "./ui/tone";

const AGENT_ICON: Record<AgentName, ReactNode> = {
  triage: <Funnel size={16} weight="light" />,
  threat_intel: <Globe size={16} weight="light" />,
  risk_scoring: <Gauge size={16} weight="light" />,
  containment: <ShieldWarning size={16} weight="light" />,
  remediation: <GitPullRequest size={16} weight="light" />,
};

/** The stage node takes the most urgent state of its lanes. */
function groupTone(group: LaneGroup): { tone: Tone; pulse: boolean } {
  const live = group.lanes.filter((lane) => !lane.placeholder);
  if (live.some((lane) => lane.status === "running")) return { tone: "info", pulse: true };
  if (live.some((lane) => lane.status === "failed")) return { tone: "danger", pulse: false };
  if (live.length > 0 && live.every((lane) => lane.status === "done")) return { tone: "success", pulse: false };
  if (live.length > 0) return { tone: "neutral", pulse: false };
  return { tone: "muted", pulse: false };
}

export function AgentLanes({ groups, index = 0 }: { groups: LaneGroup[]; index?: number }) {
  return (
    <Panel
      index={index}
      eyebrow="OpenAI Agents SDK"
      icon={<Robot size={11} weight="bold" />}
      title="The agent team"
      subtitle="Code runs the stages in order; each agent works through narrow tools. One lane per run: status, latest tool call, elapsed time."
    >
      <ol className="relative">
        <span aria-hidden className="absolute bottom-6 left-[19px] top-6 hidden w-px bg-gradient-to-b from-white/10 via-white/5 to-transparent md:block" />
        {groups.map((group) => {
          const node = groupTone(group);
          return (
            <li key={group.agent} className="relative grid gap-3 py-3 md:grid-cols-[220px_minmax(0,1fr)] md:gap-6">
              <div className="flex items-start gap-3">
                <span
                  className={`relative flex size-10 shrink-0 items-center justify-center rounded-full bg-ink-900 ring-1 ring-inset ${toneBorder[node.tone]} ${toneText[node.tone]}`}
                >
                  {AGENT_ICON[group.agent]}
                  <span className="absolute -right-0.5 -top-0.5">
                    <StatusDot tone={node.tone} pulse={node.pulse} size="sm" />
                  </span>
                </span>
                <div className="min-w-0 pt-0.5">
                  <h3 className="text-sm font-medium text-zinc-100">{group.title}</h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{group.role}</p>
                </div>
              </div>
              <div className={`grid min-w-0 gap-3 ${group.lanes.length > 1 ? "sm:grid-cols-2 2xl:grid-cols-3" : ""}`}>
                {group.lanes.map((lane) => (
                  <LaneCard key={lane.key} lane={lane} />
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function LaneCard({ lane }: { lane: LaneView }) {
  const running = lane.status === "running";
  return (
    <article
      className={`relative overflow-hidden rounded-2xl p-4 text-xs ring-1 ring-inset transition-colors duration-700 ease-spring ${
        lane.placeholder ? "bg-transparent ring-white/[0.06] [border-style:dashed]" : `${toneSurface[lane.statusTone]} ${toneBorder[lane.statusTone]}`
      }`}
    >
      {running && (
        <span aria-hidden className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className="block h-full w-1/2 animate-sweep bg-gradient-to-r from-transparent via-sky-300 to-transparent" />
        </span>
      )}
      <header className="flex items-start justify-between gap-2">
        <span className={`min-w-0 break-words text-[13px] font-medium ${lane.placeholder ? "text-zinc-500" : "text-zinc-100"}`}>
          {lane.heading}
        </span>
        <Badge tone={lane.statusTone} pulse={running}>
          {lane.statusLabel}
        </Badge>
      </header>

      {!lane.placeholder && (
        <dl className="mt-3 space-y-1.5 text-zinc-400">
          <div className="flex items-start gap-2">
            <dt className="mt-0.5 shrink-0 text-zinc-600" title="Latest tool call">
              <Wrench size={12} />
            </dt>
            <dd className="min-w-0 break-all font-mono text-[11px] text-zinc-300">{lane.lastTool ?? "-"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="shrink-0 text-zinc-600" title="Elapsed">
              <Timer size={12} />
            </dt>
            <dd className="font-mono text-[11px] tabular-nums">{formatDuration(lane.elapsedMs)}</dd>
          </div>
        </dl>
      )}

      {lane.summary && <p className={`mt-3 leading-relaxed ${lane.placeholder ? "text-zinc-600" : "text-zinc-100"}`}>{lane.summary}</p>}
      {lane.link && (
        <ExternalLink href={lane.link.url} className="mt-1.5 block text-signal-300">
          {lane.link.label}
        </ExternalLink>
      )}
      {lane.notes.length > 0 && (
        <ul className="mt-2 space-y-1 text-zinc-500">
          {lane.notes.map((note) => (
            <li key={note} className="line-clamp-2">
              {note}
            </li>
          ))}
        </ul>
      )}
      {lane.lastMessage && (
        <p className="mt-3 truncate border-t border-white/5 pt-2 font-mono text-[10.5px] text-zinc-600" title={lane.lastMessage}>
          {lane.lastMessage}
        </p>
      )}
      {lane.error && <p className="mt-2 break-words text-rose-300">{lane.error}</p>}
    </article>
  );
}
