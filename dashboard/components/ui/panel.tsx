import type { CSSProperties, ReactNode } from "react";
import { Eyebrow } from "./badge";

interface PanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Position in the load-in stagger. */
  index?: number;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** Double-bezel container: a hairline outer tray holding the inner core. */
export function Panel({
  title,
  subtitle,
  eyebrow,
  icon,
  actions,
  index = 0,
  className = "",
  bodyClassName = "px-5 pb-5",
  children,
}: PanelProps) {
  return (
    <section
      style={{ "--i": index } as CSSProperties}
      className={`reveal flex min-w-0 flex-col rounded-[1.5rem] bg-white/[0.02] p-1.5 ring-1 ring-white/[0.06] ${className}`}
    >
      <div className="flex min-h-0 flex-1 flex-col rounded-[calc(1.5rem-0.375rem)] bg-ink-900/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/[0.04]">
        <header className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
          <div className="min-w-0">
            {eyebrow && (
              <div className="mb-2.5">
                <Eyebrow icon={icon}>{eyebrow}</Eyebrow>
              </div>
            )}
            <h2 className="text-[15px] font-medium tracking-tight text-zinc-50">{title}</h2>
            {subtitle && <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-zinc-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
        <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
      </div>
    </section>
  );
}
