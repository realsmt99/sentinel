import "server-only";

import { getAgentOrigin, getAgentUrl } from "./env";

export interface AgentReply {
  status: number;
  body: unknown;
}

export async function callAgent(method: "GET" | "POST", path: string, timeoutMs: number): Promise<AgentReply> {
  const res = await fetch(`${getAgentUrl()}${path}`, {
    method,
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { ok: false, error: text.slice(0, 300) };
    }
  }
  return { status: res.status, body };
}

export function describeAgentError(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return `Sentinel agent API at ${getAgentOrigin()} did not answer in time`;
  }
  return `Sentinel agent API is not reachable at ${getAgentOrigin()} - is it running?`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** FastAPI errors come back as {detail}; the agent's own errors as {ok: false, error}. */
export function toActionResponse(reply: AgentReply): { ok: true } & Record<string, unknown> | { ok: false; error: string } {
  const body = isRecord(reply.body) ? reply.body : {};
  if (reply.status < 400 && body.ok !== false) return { ...body, ok: true };

  const detail = body.error ?? body.detail;
  const error =
    typeof detail === "string"
      ? detail
      : detail !== undefined
        ? JSON.stringify(detail).slice(0, 300)
        : `Sentinel agent API answered HTTP ${reply.status}`;
  return { ok: false, error };
}
