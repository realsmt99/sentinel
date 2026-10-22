import { connection } from "next/server";
import { callAgent, describeAgentError, toActionResponse } from "@/lib/server/agent";

/** The project connection the Connect form is pre-filled with (database password masked by the agent). */
export async function GET() {
  await connection();
  try {
    const reply = await callAgent("GET", "/config", 5_000);
    return Response.json(toActionResponse(reply), { status: reply.status >= 400 ? reply.status : 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ ok: false, error: describeAgentError(err) }, { status: 502 });
  }
}
