import { formatClock } from "@/lib/format";
import type { PhoneAlert } from "@/lib/workflow";
import { LogoMark } from "../ui/logo";

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function day(ms: number) {
  return new Date(ms).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

/** Lock screen of the on-call phone: Guard's ntfy alerts drop in as they are sent. */
export function Phone({ alerts, nowMs }: { alerts: PhoneAlert[]; nowMs: number }) {
  const newestFirst = [...alerts].reverse();
  return (
    <div className="mx-auto w-[240px] rounded-[2.5rem] bg-[#2b2b29] p-[6px] shadow-[0_24px_48px_-28px_rgba(17,17,17,0.35)]">
      <div className="relative h-[460px] overflow-hidden rounded-[2.15rem] bg-[#151514]">
        <span aria-hidden className="absolute left-1/2 top-2 h-[19px] w-[74px] -translate-x-1/2 rounded-full bg-black" />
        <div className="pt-10 text-center">
          <div className="text-[10px] font-medium text-zinc-400">{day(nowMs)}</div>
          <div className="mt-0.5 text-[44px] font-medium leading-none tracking-tight text-zinc-100">{clock(nowMs)}</div>
        </div>

        <ul className="mt-5 space-y-2 px-2">
          {newestFirst.length === 0 && <li className="pt-6 text-center text-[11px] text-zinc-600">No alerts yet</li>}
          {newestFirst.map((alert) => (
            <li key={alert.id} className="animate-rise">
              <a
                href={alert.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className={`block rounded-[1.1rem] bg-white/[0.09] p-2.5 ring-1 ring-inset transition-transform duration-300 ease-spring active:scale-[0.98] ${
                  alert.urgent ? "ring-rose-400/30" : "ring-white/10"
                }`}
              >
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-zinc-900 ring-1 ring-white/10">
                    <LogoMark className="size-3" />
                  </span>
                  <span className="font-medium uppercase tracking-wide">ntfy</span>
                  {alert.urgent && <span className="rounded-full bg-rose-500/20 px-1.5 text-[9px] font-semibold uppercase text-rose-300">Urgent</span>}
                  <span className="ml-auto">{formatClock(alert.ts)}</span>
                </div>
                <div className="mt-1 text-[12px] font-semibold leading-snug text-zinc-50">{alert.title}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-zinc-300">{alert.body}</div>
              </a>
            </li>
          ))}
        </ul>

        <span aria-hidden className="absolute bottom-2 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-white/40" />
      </div>
    </div>
  );
}
