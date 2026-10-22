"use client";

import { useEffect, useState } from "react";

/** Minimum time a scene stays on screen, so fast steps are still seen one after another. */
const DWELL_MS = 4_000;

/**
 * Walks the shown scene towards `target` one scene at a time, waiting DWELL_MS on each and
 * passing over scenes marked skippable. A target behind the shown scene (a reset) jumps back at once.
 */
export function useSceneQueue(target: number, skippable: boolean[]): number {
  const [state, setState] = useState({ index: target, at: 0 });
  const index = Math.min(state.index, target);

  useEffect(() => {
    if (state.index > target) {
      const timer = setTimeout(() => setState({ index: target, at: Date.now() }), 0);
      return () => clearTimeout(timer);
    }
    if (index >= target) return;
    let next = index + 1;
    while (next < target && skippable[next]) next += 1;
    const wait = Math.max(0, DWELL_MS - (Date.now() - state.at));
    const timer = setTimeout(() => setState({ index: next, at: Date.now() }), wait);
    return () => clearTimeout(timer);
  }, [index, target, state.index, state.at, skippable]);

  return index;
}
