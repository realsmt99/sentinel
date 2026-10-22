import type { NextRequest } from "next/server";
import { callAgent, describeAgentError, toActionResponse } from "@/lib/server/agent";
import { ACTION_NAMES, type ActionName, type ActionResponse } from "@/lib/types";

const ACTION_TIMEOUT_MS = 20_000;
const SERVICE_NAME = /^[a-z0-9][a-z0-9_.-]{0,62}$/i;

function isActionName(name: string): name is ActionName {
  return (ACTION_NAMES as readonly string[]).includes(name);
}

function agentPath(action: ActionName, service: string | null): string {
  switch (action) {
    case "connect":
      return "/connect";
    case "replay":
      return "/demo/replay";
    case "reset":
      return "/demo/reset";
    case "restore":
      return `/restore/${encodeURIComponent(service ?? "")}`;
  }
}

async function readService(request: NextRequest): Promise<string | null> {
  const body: unknown = await request.json().catch(() => null);
  const fromBody =
    typeof body === "object" && body !== null && "service" in body && typeof body.service === "string"
      ? body.service
      : null;
  return fromBody ?? request.nextUrl.searchParams.get("service");
}

function reply(body: ActionResponse, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/action/[name]">) {
  const { name } = await ctx.params;
  if (!isActionName(name)) {
    return reply({ ok: false, error: `Unknown action. Allowed: ${ACTION_NAMES.join(", ")}` }, 404);
  }

  let service: string | null = null;
  if (name === "restore") {
    service = await readService(request);
    if (!service || !SERVICE_NAME.test(service)) {
      return reply({ ok: false, error: 'restore needs a service name, e.g. {"service": "shop"}' }, 400);
    }
  }

  try {
    const agentReply = await callAgent("POST", agentPath(name, service), ACTION_TIMEOUT_MS);
    return reply(toActionResponse(agentReply), agentReply.status >= 400 ? agentReply.status : 200);
  } catch (err) {
    return reply({ ok: false, error: describeAgentError(err) }, 502);
  }
}
