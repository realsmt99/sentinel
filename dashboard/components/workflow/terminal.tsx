"use client";

import { useEffect, useRef } from "react";
import type { TraceLine } from "@/lib/trace";
import { toneText } from "../ui/tone";

/** What the agents are doing in the background: the live agent_log, newest at the bottom. */
export function Terminal({ lines, busy }: { lines: TraceLine[]; busy: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = lines.length ? lines[lines.length - 1].id : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastId]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-terminal">
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-3.5 py-2.5">
        <span className="font-mono text-[11px] text-zinc-400">guard · agent log</span>
        <span className={`flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] ${busy ? "text-signal-300" : "text-zinc-600"}`}>
          <span className={`size-1.5 rounded-full ${busy ? "animate-breathe bg-signal-400" : "bg-zinc-600"}`} />
          {busy ? "working" : "idle"}
        </span>
      </header>
      <div ref={scrollRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3.5 py-3 font-mono text-[11px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-zinc-600">Waiting for the first agent step...</p>
        ) : (
          lines.map((line) => (
            <p key={line.id} className="animate-line-in break-words py-[2px]">
              <span className="text-zinc-600">{line.time}</span>{" "}
              <span className="text-zinc-500">{line.label}</span> <span className={toneText[line.tone]}>{line.message}</span>
            </p>
          ))
        )}
        <p className="flex items-center gap-1.5 pt-1 text-zinc-600">
          <span className="text-signal-400">$</span>
          <span className="inline-block h-3 w-1.5 animate-caret bg-signal-400/80" />
        </p>
      </div>
    </section>
  );
}
