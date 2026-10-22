import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HistoryDoc, HistoryEntry } from "@/lib/types";

// Written by the Guard backend (sentinel/sentinel/history.py) at the repository root.
const HISTORY_DIR = path.resolve(process.cwd(), "..", "history");
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/;

async function readDoc(id: string): Promise<HistoryDoc | null> {
  if (!RUN_ID.test(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(HISTORY_DIR, `${id}.json`), "utf8")) as HistoryDoc;
  } catch {
    return null;
  }
}

/** Saved runs, newest first. */
export async function listHistory(): Promise<HistoryEntry[]> {
  let files: string[];
  try {
    files = await readdir(HISTORY_DIR);
  } catch {
    return [];
  }
  const docs = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readDoc(f.slice(0, -5))));
  return docs
    .filter((doc): doc is HistoryDoc => doc !== null)
    .map(
      (doc): HistoryEntry => ({
        id: doc.id,
        title: doc.title,
        status: doc.status,
        outcome: doc.outcome,
        startedAt: doc.startedAt,
        endedAt: doc.endedAt,
        updatedAt: doc.updatedAt,
        summary: doc.summary,
      }),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function readHistory(id: string): Promise<HistoryDoc | null> {
  return readDoc(id);
}
