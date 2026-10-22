import { connection } from "next/server";
import { callAgent, describeAgentError } from "@/lib/server/agent";
import { getAgentOrigin } from "@/lib/server/env";
import type { HealthResponse, HealthValue } from "@/lib/types";

const HEALTH_TIMEOUT_MS = 2_500;

function toValue(value: unknown): HealthValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "object" && "ok" in value) return value.ok === true;
  return String(value);
}

export async function GET() {
  await connection();
  const agentUrl = getAgentOrigin();
  let health: HealthResponse;

  try {
    const reply = await callAgent("GET", "/health", HEALTH_TIMEOUT_MS);
    const body = reply.body;
    if (reply.status >= 400 || typeof body !== "object" || body === null || Array.isArray(body)) {
      health = { reachable: false, agentUrl, error: `GET /health answered HTTP ${reply.status}` };
    } else {
      const checks = Object.fromEntries(
        Object.entries(body)
          .filter(([key]) => key !== "ok")
          .map(([key, value]) => [key, toValue(value)]),
      );
      health = { reachable: true, agentUrl, checks };
    }
  } catch (err) {
    health = { reachable: false, agentUrl, error: describeAgentError(err) };
  }

  return Response.json(health, { headers: { "Cache-Control": "no-store" } });
}
