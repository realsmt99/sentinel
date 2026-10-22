import type { ReactNode } from "react";
import type { Tone } from "@/lib/labels";

/** Washed-out pastels, used only for meaning. */
export const PASTEL: Record<Tone, { bg: string; text: string; bar: string }> = {
  success: { bg: "bg-pale-green", text: "text-pale-green-ink", bar: "bg-pale-green-ink" },
  danger: { bg: "bg-pale-red", text: "text-pale-red-ink", bar: "bg-pale-red-ink" },
  warning: { bg: "bg-pale-yellow", text: "text-pale-yellow-ink", bar: "bg-pale-yellow-ink" },
  info: { bg: "bg-pale-blue", text: "text-pale-blue-ink", bar: "bg-pale-blue-ink" },
  neutral: { bg: "bg-bone-200", text: "text-ink-soft", bar: "bg-ink-soft" },
  muted: { bg: "bg-bone-100", text: "text-mute", bar: "bg-line" },
};

export function Tag({ tone = "neutral", pulse = false, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  const p = PASTEL[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.06em] ${p.bg} ${p.text}`}>
      {pulse && <span className="size-1.5 animate-breathe rounded-full bg-current" />}
      {children}
    </span>
  );
}
