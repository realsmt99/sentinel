"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Poll<T> {
  /** Last response body, good or not. */
  latest: T | null;
  /** Last body accepted by `isGood`; kept while later polls fail. */
  lastGood: T | null;
  /** Network or parse error of the last attempt. */
  error: string | null;
  /** Client time (ms) when lastGood arrived. */
  receivedAt: number;
  /** Client time (ms) of the last attempt, successful or not. */
  checkedAt: number;
}

const INITIAL = { latest: null, lastGood: null, error: null, receivedAt: 0, checkedAt: 0 };

/**
 * Polls `url` every `intervalMs` (next request only after the previous one settles) and pauses while
 * the tab is hidden. `isGood` must be a stable function (module scope).
 */
export function usePolling<T>(url: string, intervalMs: number, isGood: (body: T) => boolean) {
  const [poll, setPoll] = useState<Poll<T>>(INITIAL);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight: AbortController | null = null;

    const schedule = () => {
      clearTimeout(timer);
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(tick, intervalMs);
    };

    async function tick() {
      clearTimeout(timer);
      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;

      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        const body = (await res.json()) as T;
        const now = Date.now();
        const good = isGood(body);
        setPoll((prev) => ({
          latest: body,
          lastGood: good ? body : prev.lastGood,
          error: null,
          receivedAt: good ? now : prev.receivedAt,
          checkedAt: now,
        }));
      } catch (err) {
        if (controller.signal.aborted) return;
        const now = Date.now();
        const message = err instanceof Error ? err.message : String(err);
        setPoll((prev) => ({ ...prev, error: message, checkedAt: now }));
      }

      if (inflight === controller) {
        inflight = null;
        schedule();
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void tick();
      } else {
        clearTimeout(timer);
        inflight?.abort();
      }
    };

    refreshRef.current = () => void tick();
    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();

    return () => {
      stopped = true;
      clearTimeout(timer);
      inflight?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      refreshRef.current = () => undefined;
    };
  }, [url, intervalMs, isGood]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...poll, refresh };
}
