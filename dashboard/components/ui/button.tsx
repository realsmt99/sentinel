import type { ReactNode } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT: Record<Variant, { shell: string; well: string }> = {
  primary: {
    shell: "bg-signal-400 text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] hover:bg-signal-300",
    well: "bg-zinc-950/10",
  },
  secondary: {
    shell: "bg-white/[0.04] text-zinc-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.08]",
    well: "bg-white/[0.06]",
  },
  danger: {
    shell: "bg-rose-500 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-rose-400",
    well: "bg-black/15",
  },
};

interface ButtonProps {
  variant?: Variant;
  busy?: boolean;
  disabled?: boolean;
  title?: string;
  icon?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}

export function Button({ variant = "secondary", busy = false, disabled = false, title, icon, onClick, children }: ButtonProps) {
  const style = VARIANT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      title={title}
      className={`group inline-flex items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 text-[13px] font-medium transition-[transform,background-color,opacity] duration-500 ease-spring active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${style.shell}`}
    >
      <span className="whitespace-nowrap">{children}</span>
      <span
        className={`flex size-7 items-center justify-center rounded-full transition-transform duration-500 ease-spring group-enabled:group-hover:-translate-y-px group-enabled:group-hover:translate-x-0.5 group-enabled:group-hover:scale-105 ${style.well}`}
      >
        {busy ? <BusyDots /> : (icon ?? <ArrowUpRight size={14} weight="bold" />)}
      </span>
    </button>
  );
}

function BusyDots() {
  return (
    <span className="flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 animate-breathe rounded-full bg-current" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}
