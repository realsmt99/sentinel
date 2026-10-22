import "server-only";

import { Pool, type PoolConfig } from "pg";
import { getDatabaseUrl } from "./env";

// pg lets connection-string parameters override the `ssl` option, and treats sslmode=require as
// verify-full, which rejects Aiven's CA. Strip them and decide SSL here instead.
const SSL_URL_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "sslnegotiation", "uselibpqcompat"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const globalForDb = globalThis as typeof globalThis & {
  sentinelDb?: { pool: Pool; databaseUrl: string };
};

function poolConfig(databaseUrl: string): PoolConfig {
  const base: PoolConfig = {
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 5_000,
    query_timeout: 8_000,
    keepAlive: true,
    application_name: "sentinel-dashboard",
  };

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return { ...base, connectionString: databaseUrl, ssl: { rejectUnauthorized: false } };
  }

  const sslmode = url.searchParams.get("sslmode");
  for (const param of SSL_URL_PARAMS) url.searchParams.delete(param);
  const useSsl = sslmode ? sslmode !== "disable" : !LOCAL_HOSTS.has(url.hostname);

  return {
    ...base,
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  };
}

/** Shared pool, or null when DATABASE_URL is not configured. */
export function getPool(): Pool | null {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;

  const cached = globalForDb.sentinelDb;
  if (cached?.databaseUrl === databaseUrl) return cached.pool;
  if (cached) void cached.pool.end().catch(() => undefined);

  const pool = new Pool(poolConfig(databaseUrl));
  pool.on("error", (err) => {
    console.error(`[dashboard] idle database connection error: ${redact(err.message)}`);
  });
  globalForDb.sentinelDb = { pool, databaseUrl };
  return pool;
}

/** Removes the connection string and its password from a message before it reaches a client. */
export function redact(message: string): string {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return message;
  let out = message.split(databaseUrl).join("[DATABASE_URL]");
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    if (password) out = out.split(password).join("[redacted]");
  } catch {
    // not a URL: nothing more to strip
  }
  return out;
}
