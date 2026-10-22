"use client";

import Link from "next/link";
import { ListNumbers, SquaresFour } from "@phosphor-icons/react";
import type { ActionControl, ActionControls } from "@/lib/actions";
import type { Tone } from "@/lib/labels";
import type { HistoryEntry, RunInfo } from "@/lib/types";
import { ActionButtonView } from "../action-bar";
import { Tag } from "../stage/tag";
import { LogoMark } from "../ui/logo";

const OUTCOME: Record<string, { label: string; tone: Tone }> = {
  resolved: { label: "Solved", tone: "success" },
  contained: { label: "Contained", tone: "danger" },
  patching: { label: "Fix open", tone: "warning" },
  "no impact": { label: "No impact", tone: "neutral" },
  connected: { label: "Connected", tone: "muted" },
  empty: { label: "Empty", tone: "muted" },
};

function dayLabel(iso: string): string {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return "Today";
  if (day.toDateString() === yesterday.toDateString()) return "Yesterday";
  return day.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface SidebarProps {
  liveRun: RunInfo | null;
  history: HistoryEntry[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  controls: ActionControls | null;
  onRun: (control: ActionControl) => void;
}

export function Sidebar({ liveRun, history, selected, onSelect, controls, onRun }: SidebarProps) {
  const past = history.filter((h) => h.id !== liveRun?.id);
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of past) {
    const label = dayLabel(entry.startedAt);
    groups.set(label, [...(groups.get(label) ?? []), entry]);
  }

  return (
    <aside className="hidden w-[272px] shrink-0 flex-col border-r border-line bg-bone-50 md:flex">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <LogoMark className="size-6" ink />
        <span className="text-[15px] font-semibold tracking-tight text-ink">Guard</span>
      </div>

      {controls && (
        <div className="space-y-2 px-4 pb-4">
          <ActionButtonView control={controls.newRun} onRun={onRun} compact theme="light" />
          <ActionButtonView control={controls.reset} onRun={onRun} compact theme="light" />
        </div>
      )}

      <nav className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Runs">
        {liveRun && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`mb-4 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors duration-200 ${
              selected === null ? "bg-white shadow-[0_1px_2px_rgba(17,17,17,0.04)] ring-1 ring-line" : "hover:bg-bone-100"
            }`}
          >
            <span className="size-2 shrink-0 animate-breathe rounded-full bg-pale-green-ink" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{liveRun.title}</span>
              <span className="block text-[11px] text-mute">Live run · started {time(liveRun.started_at)}</span>
            </span>
          </button>
        )}

        {[...groups].map(([label, entries]) => (
          <div key={label} className="mb-4">
            <div className="px-3 pb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{label}</div>
            <ul className="space-y-0.5">
              {entries.map((entry) => {
                const outcome = OUTCOME[entry.outcome] ?? { label: entry.outcome, tone: "muted" as Tone };
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(entry.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition-colors duration-200 ${
                        selected === entry.id ? "bg-white ring-1 ring-line" : "hover:bg-bone-100"
                      }`}
                    >
                      <span className="block truncate text-sm text-ink-soft">{entry.title}</span>
                      <span className="mt-1 flex items-center gap-2">
                        <Tag tone={outcome.tone}>{outcome.label}</Tag>
                        <span className="font-mono text-[11px] text-mute">{time(entry.startedAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {past.length === 0 && <p className="px-3 text-xs leading-relaxed text-mute">Finished runs are saved here, on this machine, in history/.</p>}
      </nav>

      <div className="flex gap-2 border-t border-line px-4 py-3">
        <Link href="/stage" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-mute transition-colors duration-200 hover:bg-bone-100 hover:text-ink">
          <ListNumbers size={13} weight="bold" />
          Step by step
        </Link>
        <Link href="/details" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-mute transition-colors duration-200 hover:bg-bone-100 hover:text-ink">
          <SquaresFour size={13} weight="bold" />
          Details
        </Link>
      </div>
    </aside>
  );
}
