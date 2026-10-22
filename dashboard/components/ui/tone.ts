import type { Tone } from "@/lib/labels";

export const toneBadge: Record<Tone, string> = {
  neutral: "bg-white/[0.06] text-zinc-200 ring-white/10",
  muted: "bg-white/[0.02] text-zinc-500 ring-white/[0.06]",
  info: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  success: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  warning: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  danger: "bg-rose-500/10 text-rose-300 ring-rose-400/25",
};

export const toneText: Record<Tone, string> = {
  neutral: "text-zinc-100",
  muted: "text-zinc-500",
  info: "text-sky-300",
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-rose-300",
};

export const toneDot: Record<Tone, string> = {
  neutral: "bg-zinc-300",
  muted: "bg-zinc-600",
  info: "bg-sky-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-rose-400",
};

export const toneBorder: Record<Tone, string> = {
  neutral: "ring-white/[0.08]",
  muted: "ring-white/[0.05]",
  info: "ring-sky-400/25",
  success: "ring-emerald-400/20",
  warning: "ring-amber-400/25",
  danger: "ring-rose-400/30",
};

/** Faint tint for surfaces whose state matters (offline service, failed lane). */
export const toneSurface: Record<Tone, string> = {
  neutral: "bg-white/[0.02]",
  muted: "bg-white/[0.01]",
  info: "bg-sky-400/[0.04]",
  success: "bg-emerald-400/[0.03]",
  warning: "bg-amber-400/[0.04]",
  danger: "bg-rose-500/[0.06]",
};

export const toneStroke: Record<Tone, string> = {
  neutral: "stroke-zinc-300",
  muted: "stroke-zinc-600",
  info: "stroke-sky-400",
  success: "stroke-emerald-400",
  warning: "stroke-amber-400",
  danger: "stroke-rose-400",
};
