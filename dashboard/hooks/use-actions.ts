"use client";

import { useCallback, useState } from "react";
import { actionKey, type ActionPhase } from "@/lib/actions";
import type { ActionName, ActionResponse } from "@/lib/types";

export function useActions(onAccepted: () => void) {
  const [phases, setPhases] = useState<Record<string, ActionPhase>>({});

  const run = useCallback(
    async (name: ActionName, service?: string | null, payload?: Record<string, string | boolean>) => {
      const key = actionKey(name, service);
      setPhases((prev) => ({ ...prev, [key]: { kind: "sending", at: Date.now() } }));

      let next: ActionPhase;
      try {
        const res = await fetch(`/api/action/${name}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, ...(service ? { service } : {}) }),
        });
        const body = (await res.json().catch(() => null)) as ActionResponse | null;
        if (body?.ok) {
          next = { kind: "waiting", at: Date.now() };
          onAccepted();
        } else {
          const message = body && !body.ok ? body.error : `Dashboard API answered HTTP ${res.status}`;
          next = { kind: "failed", at: Date.now(), message };
        }
      } catch (err) {
        next = { kind: "failed", at: Date.now(), message: err instanceof Error ? err.message : String(err) };
      }
      setPhases((prev) => ({ ...prev, [key]: next }));
    },
    [onAccepted],
  );

  return { phases, run };
}
