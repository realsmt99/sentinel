import { laneLabel } from "@/lib/labels";
import type { DashboardState } from "@/lib/types";
import { GuardAvatar } from "./message";

/** What Guard is doing right now, or null when nothing runs in the background. */
export function currentActivity(state: DashboardState, streaming: boolean): string | null {
  const running = [...state.agentRuns].reverse().find((r) => r.status === "running");
  if (running) {
    const line = [...state.log].reverse().find((l) => l.agent === running.agent && l.service === running.service);
    return line?.message ?? `${laneLabel(running.agent, running.service)}: ${running.last_tool ?? "working"}`;
  }
  if (streaming) return `Reading the feed: ${state.funnel.total} CVEs received`;
  return null;
}

export function Thinking({ text }: { text: string }) {
  return (
    <div className="flex animate-rise gap-3.5">
      <GuardAvatar />
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex items-center gap-1" aria-label="Guard is working">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-breathe rounded-full bg-ink/50" style={{ animationDelay: `${i * 180}ms` }} />
          ))}
        </div>
        <p key={text} className="mt-2 max-w-[68ch] animate-line-in truncate font-mono text-[12px] text-mute">
          {text}
        </p>
      </div>
    </div>
  );
}
