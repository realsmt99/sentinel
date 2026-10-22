"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ArrowCounterClockwise, Broadcast, PlugsConnected, ShieldCheck } from "@phosphor-icons/react";
import type { ActionControl, ActionControls } from "@/lib/actions";
import type { ActionName } from "@/lib/types";
import { toneText } from "./ui/tone";
import { Button } from "./ui/button";

const CONFIRM_WINDOW_MS = 4_000;

const ACTION_ICON: Record<ActionName, ReactNode> = {
  connect: <PlugsConnected size={14} weight="bold" />,
  replay: <Broadcast size={14} weight="bold" />,
  restore: <ShieldCheck size={14} weight="bold" />,
  reset: <ArrowCounterClockwise size={14} weight="bold" />,
};

interface ActionBarProps {
  controls: ActionControls;
  onRun: (control: ActionControl) => void;
}

export function ActionBar({ controls, onRun }: ActionBarProps) {
  const ordered = [controls.connect, controls.replay, controls.restore, controls.reset];
  const messages = [...ordered, ...Object.values(controls.restoreByService)]
    .map((control) => control.message)
    .filter((message) => message !== null);
  const uniqueMessages = [...new Map(messages.map((m) => [m.text, m])).values()];

  return (
    <div>
      <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 xl:flex xl:flex-wrap xl:items-start">
        {ordered.map((control) => (
          <ActionButtonView key={control.button.name} control={control} onRun={onRun} />
        ))}
      </div>
      {uniqueMessages.length > 0 && (
        <ul className="mt-4 space-y-1 border-t border-white/5 pt-3 text-xs">
          {uniqueMessages.map((message) => (
            <li key={message.text} className={toneText[message.tone]}>
              {message.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ActionButtonView({ control, onRun }: { control: ActionControl; onRun: (control: ActionControl) => void }) {
  const { button, busy, disabled } = control;
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const onClick = () => {
    if (button.confirmLabel && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onRun(control);
  };

  const label = busy ? button.busyLabel : armed && button.confirmLabel ? button.confirmLabel : button.label;
  const variant = armed ? "danger" : button.emphasis && !disabled ? "primary" : "secondary";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button
        variant={variant}
        busy={busy}
        disabled={disabled}
        title={button.hint ?? undefined}
        icon={ACTION_ICON[button.name]}
        onClick={onClick}
      >
        {label}
      </Button>
      {button.hint && <span className="max-w-60 pl-4 text-[11px] leading-snug text-zinc-500">{button.hint}</span>}
    </div>
  );
}
