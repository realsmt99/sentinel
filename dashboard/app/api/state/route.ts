import { connection } from "next/server";
import { readDashboardState } from "@/lib/server/state";

// With Cache Components on, `export const dynamic` is not allowed; connection() is what keeps this
// handler out of prerendering so every poll reads the database.
export async function GET() {
  await connection();
  const state = await readDashboardState();
  return Response.json(state, {
    status: state.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
