"use client";

import { useEffect, useState, type ReactNode } from "react";
import { formatClock } from "@/lib/format";
import type { ChatMessage } from "@/lib/types";
import { LogoMark } from "../ui/logo";

const CHARS_PER_TICK = 3;
const TICK_MS = 16;

/** Reveals text like a model streaming its answer; renders at once when not animated. */
function useTypewriter(text: string, animate: boolean): { shown: string; done: boolean } {
  const [count, setCount] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => {
      setCount((n) => {
        const next = Math.min(n + CHARS_PER_TICK, text.length);
        if (next >= text.length) clearInterval(timer);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [animate, text]);
  const shown = animate ? text.slice(0, count) : text;
  return { shown, done: shown.length >= text.length };
}

export function GuardAvatar() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-white">
      <LogoMark className="size-[18px]" ink />
    </span>
  );
}

interface MessageProps {
  message: ChatMessage;
  animate: boolean;
  card: ReactNode;
}

export function Message({ message, animate, card }: MessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex animate-rise justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-bone-200 px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.role === "event") {
    return (
      <div className="flex animate-rise items-center gap-3 text-xs text-mute">
        <span className="h-px flex-1 bg-line" />
        <span className="text-center">
          {message.text} <span className="font-mono">{formatClock(message.ts)}</span>
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }
  return <GuardMessage message={message} animate={animate} card={card} />;
}

function GuardMessage({ message, animate, card }: MessageProps) {
  const { shown, done } = useTypewriter(message.text, animate);
  return (
    <div className="flex animate-rise gap-3.5">
      <GuardAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-ink">Guard</span>
          <span className="font-mono text-[11px] text-mute">{formatClock(message.ts)}</span>
        </div>
        <p className="mt-1 max-w-[68ch] whitespace-pre-line text-[15px] leading-[1.7] text-ink-soft">
          {shown}
          {!done && <span className="ml-0.5 inline-block h-4 w-1.5 animate-caret bg-ink/60 align-[-2px]" />}
        </p>
        {card && done && <div className="mt-4 animate-rise">{card}</div>}
      </div>
    </div>
  );
}
