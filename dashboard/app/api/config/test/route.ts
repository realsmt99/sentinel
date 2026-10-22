import type { NextRequest } from "next/server";
import { callAgent, describeAgentError, toActionResponse } from "@/lib/server/agent";

const FIELDS = new Set(["database_url", "github_repo", "compose_file", "target_url", "ntfy_topic"]);

/** Tests one Connect form field live through the agent. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { field?: unknown; value?: unknown } | null;
  const field = typeof body?.field === "string" ? body.field : "";
  if (!FIELDS.has(field)) return Response.json({ ok: false, error: "unknown field" }, { status: 400 });
  const value = typeof body?.value === "string" ? body.value : "";
  try {
    const reply = await callAgent("POST", "/config/test", 20_000, { field, value });
    return Response.json(toActionResponse(reply), { status: reply.status >= 400 ? reply.status : 200 });
  } catch (err) {
    return Response.json({ ok: false, error: describeAgentError(err) }, { status: 502 });
  }
}
