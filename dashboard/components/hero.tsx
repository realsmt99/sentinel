import type { CSSProperties } from "react";
import type { ActionControl, ActionControls } from "@/lib/actions";
import type { Headline } from "@/lib/headline";
import { ActionBar } from "./action-bar";
import { Eyebrow, StatusDot } from "./ui/badge";

interface HeroProps {
  headline: Headline;
  controls: ActionControls;
  onRun: (control: ActionControl) => void;
  index?: number;
  className?: string;
}

export function Hero({ headline, controls, onRun, index = 0, className = "" }: HeroProps) {
  return (
    <section
      style={{ "--i": index } as CSSProperties}
      className={`reveal rounded-[1.75rem] bg-white/[0.02] p-1.5 ring-1 ring-white/[0.06] ${className}`}
    >
      <div className="flex h-full flex-col justify-between gap-10 rounded-[calc(1.75rem-0.375rem)] bg-ink-900/80 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.04] md:p-9">
        <div>
          <Eyebrow icon={<StatusDot tone={headline.tone} pulse size="sm" />}>{headline.eyebrow}</Eyebrow>
          <h1 className="mt-5 max-w-[24ch] text-3xl font-medium leading-[1.08] tracking-tighter text-zinc-50 md:text-[2.5rem]">
            {headline.title}
          </h1>
          <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-zinc-400">{headline.body}</p>
        </div>
        <dl className="grid grid-cols-1 gap-4 border-y border-white/5 py-5 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-white/5">
          {headline.stats.map((stat) => (
            <div key={stat.label} className="min-w-0 sm:px-5 sm:first:pl-0">
              <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">{stat.label}</dt>
              <dd className="mt-1.5 truncate font-mono text-2xl font-medium tabular-nums tracking-tight text-zinc-50">{stat.value}</dd>
              <dd className="mt-1 text-[11px] text-zinc-500">{stat.hint}</dd>
            </div>
          ))}
        </dl>
        <ActionBar controls={controls} onRun={onRun} />
      </div>
    </section>
  );
}
