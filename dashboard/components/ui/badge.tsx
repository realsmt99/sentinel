import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";
import { toneBadge, toneDot } from "./tone";

export function Badge({ tone = "neutral", pulse = false, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ring-1 ring-inset ${toneBadge[tone]}`}
    >
      {pulse && <StatusDot tone={tone} pulse size="sm" />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse = false, size = "md" }: { tone: Tone; pulse?: boolean; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "size-1.5" : "size-2";
  return (
    <span className={`relative inline-flex shrink-0 ${dim}`}>
      {pulse && <span className={`absolute inset-0 animate-ping-soft rounded-full ${toneDot[tone]}`} />}
      <span className={`relative inline-block rounded-full ${dim} ${toneDot[tone]}`} />
    </span>
  );
}

/** Microscopic pill above a heading. */
export function Eyebrow({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400 ring-1 ring-inset ring-white/[0.06]">
      {icon}
      {children}
    </span>
  );
}
