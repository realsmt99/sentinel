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
    case "newrun":
      return "/demo/new-run";
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

const CONNECTION_FIELDS = ["database_url", "github_repo", "compose_file", "target_url", "ntfy_topic"] as const;

/** The Connect form's fields, passed through as strings; anything else is dropped. */
async function readConnection(request: NextRequest): Promise<Record<string, string> | undefined> {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return undefined;
  const source = body as Record<string, unknown>;
  const fields = Object.fromEntries(
    CONNECTION_FIELDS.filter((key) => typeof source[key] === "string").map((key) => [key, source[key] as string]),
  );
  return Object.keys(fields).length ? fields : undefined;
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
  let connection: Record<string, string> | undefined;
  if (name === "restore") {
    service = await readService(request);
    if (!service || !SERVICE_NAME.test(service)) {
      return reply({ ok: false, error: 'restore needs a service name, e.g. {"service": "shop"}' }, 400);
    }
  } else if (name === "connect") {
    connection = await readConnection(request);
  }

  try {
    const agentReply = await callAgent("POST", agentPath(name, service), ACTION_TIMEOUT_MS, connection);
    return reply(toActionResponse(agentReply), agentReply.status >= 400 ? agentReply.status : 200);
  } catch (err) {
    return reply({ ok: false, error: describeAgentError(err) }, 502);
  }
}
