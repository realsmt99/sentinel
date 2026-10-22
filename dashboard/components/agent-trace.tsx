"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, TerminalWindow } from "@phosphor-icons/react";
import type { TraceLine } from "@/lib/trace";
import { Panel } from "./ui/panel";
import { toneText } from "./ui/tone";

const FOLLOW_THRESHOLD_PX = 40;

interface AgentTraceProps {
  lines: TraceLine[];
  index?: number;
  className?: string;
}

/** Sticks to the newest line unless the reader has scrolled up. */
export function AgentTrace({ lines, index = 0, className = "" }: AgentTraceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const lastId = lines.length ? lines[lines.length - 1].id : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
    followRef.current = atBottom;
    setFollowing(atBottom);
  };

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    setFollowing(true);
    el.scrollTop = el.scrollHeight;
  };

  return (
    <Panel
      index={index}
      eyebrow="agent_log · Aiven"
      icon={<TerminalWindow size={11} weight="bold" />}
      title="Live agent trace"
      subtitle="Every agent start, tool call and decision, newest 80 lines."
      className={className}
      bodyClassName="relative mx-1.5 mb-1.5 overflow-hidden rounded-[1.1rem] bg-black/35 ring-1 ring-inset ring-white/5"
      actions={
        !following && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-3 py-1 text-[11px] text-zinc-300 ring-1 ring-inset ring-white/10 transition-colors duration-300 hover:bg-white/10 active:scale-[0.98]"
          >
            <ArrowDown size={11} weight="bold" />
            Latest
          </button>
        )
      }
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="thin-scroll absolute inset-0 overflow-y-auto px-4 pb-10 pt-3 font-mono text-[11.5px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="text-zinc-600">No agent activity yet.</p>
        ) : (
          lines.map((line) => (
            <p key={line.id} className="animate-line-in break-words py-[3px]">
              <span className="text-zinc-600">{line.time}</span>{" "}
              <span className="rounded bg-white/[0.05] px-1 py-px text-[10px] uppercase tracking-wider text-zinc-400">{line.label}</span>{" "}
              <span className={toneText[line.tone]}>{line.message}</span>
            </p>
          ))
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 via-black/60 to-transparent px-4 pb-2.5 pt-6 font-mono text-[11px] text-zinc-500">
        <span className="text-signal-400">sentinel</span>
        <span>listening on cve_batch</span>
        <span className="inline-block h-3 w-1.5 animate-caret bg-signal-400/80" />
      </div>
    </Panel>
  );
}
