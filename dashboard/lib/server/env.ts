import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

// One .env for the whole repo: `pnpm dev` runs from dashboard/, so the root file is one level up.
// Variables already set in the shell win over the file.
export const ROOT_ENV_FILE = path.resolve(process.cwd(), "..", ".env");

const DEFAULT_AGENT_URL = "http://localhost:8000";
const RELOAD_INTERVAL_MS = 2_000;

let lastLoadAt = 0;

function loadRootEnv(): void {
  lastLoadAt = Date.now();
  if (existsSync(ROOT_ENV_FILE)) {
    config({ path: ROOT_ENV_FILE, quiet: true });
  }
}

loadRootEnv();

/** Re-reads the root .env while DATABASE_URL is missing, so filling it in needs no restart. */
export function getDatabaseUrl(): string | null {
  if (!process.env.DATABASE_URL && Date.now() - lastLoadAt > RELOAD_INTERVAL_MS) {
    loadRootEnv();
  }
  return process.env.DATABASE_URL?.trim() || null;
}

export function getAgentUrl(): string {
  return (process.env.AGENT_URL?.trim() || DEFAULT_AGENT_URL).replace(/\/+$/, "");
}

/** Scheme, host and port only, safe to show in the UI. */
export function getAgentOrigin(): string {
  try {
    return new URL(getAgentUrl()).origin;
  } catch {
    return "invalid AGENT_URL";
  }
}
