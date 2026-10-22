import { connection } from "next/server";
import { getTargetUrl } from "@/lib/server/env";
import type { SiteCheck } from "@/lib/types";

const TIMEOUT_MS = 2_500;

/** Requests the protected website server-side, the way a visitor would, and reports what it served. */
export async function GET() {
  await connection();
  const url = getTargetUrl();
  const started = Date.now();
  let check: SiteCheck;
  try {
    const res = await fetch(url, { cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const html = (await res.text()).slice(0, 200_000);
    check = {
      url,
      status: res.status,
      ms: Date.now() - started,
      maintenance: /name="sentinel-page"\s+content="maintenance"/.test(html),
      phpVersion: /Powered by PHP\s+([\d.]+)/.exec(html)?.[1] ?? null,
      error: null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    check = {
      url,
      status: null,
      ms: Date.now() - started,
      maintenance: false,
      phpVersion: null,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
  return Response.json(check, { headers: { "Cache-Control": "no-store" } });
}
