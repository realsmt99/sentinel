import Link from "next/link";
import { ListNumbers } from "@phosphor-icons/react";
import type { HealthItem, LiveStatus } from "@/lib/health";
import { Badge, StatusDot } from "./ui/badge";
import { LogoMark } from "./ui/logo";

interface HeaderProps {
  live: LiveStatus;
  health: HealthItem[];
}

export function Header({ live, health }: HeaderProps) {
  return (
    <header className="reveal sticky top-3 z-40 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-[1.25rem] bg-ink-950/75 px-4 py-2.5 ring-1 ring-white/[0.07] backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <LogoMark className="size-7" />
        <div className="flex items-baseline gap-2.5">
          <span className="text-[15px] font-semibold tracking-tight text-zinc-50">Guard</span>
          <span className="hidden text-xs text-zinc-500 sm:inline">autonomous SecOps on Aiven</span>
        </div>
        <Badge tone={live.tone} pulse={live.pulse}>
          {live.label}
        </Badge>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-zinc-400 ring-1 ring-inset ring-white/10 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-100"
        >
          <ListNumbers size={13} />
          Step-by-step view
        </Link>
      </div>
      <HealthStrip items={health} />
    </header>
  );
}

export function HealthStrip({ items }: { items: HealthItem[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Health">
      {items.map((item) => (
        <li
          key={item.key}
          title={item.detail}
          className="flex items-center gap-1.5 rounded-full bg-white/[0.03] px-2 py-0.5 text-[11px] text-zinc-400 ring-1 ring-inset ring-white/[0.05]"
        >
          <StatusDot tone={item.tone} size="sm" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
