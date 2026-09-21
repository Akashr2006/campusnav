import fs from "node:fs";
import path from "node:path";
import type { DraftSnapshot } from "@/lib/services/publish-service";

/**
 * File-backed store used when no DATABASE_URL is configured, so the admin panel
 * can build and publish a campus without Postgres. Data lives in `.data/` next
 * to the project and is shared by every browser hitting this server.
 */

const DATA_DIR = path.join(process.cwd(), ".data");
const PUBLISHED_FILE = path.join(DATA_DIR, "published_graph.json");
const DRAFT_FILE = path.join(DATA_DIR, "draft_graph.json");

export type LocalPublishedRecord = {
  version: number;
  snapshot: DraftSnapshot;
  publishedAt: string;
  publishedBy: string;
  notes?: string;
};

function readJson<T>(file: string): T | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[LocalStore] Could not read ${path.basename(file)}:`, err);
    return null;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot truncate the store. */
function writeJson(file: string, value: unknown): boolean {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    console.error(`[LocalStore] Failed to write ${path.basename(file)}:`, err);
    return false;
  }
}

export function readLocalPublished(): LocalPublishedRecord | null {
  const record = readJson<LocalPublishedRecord>(PUBLISHED_FILE);
  if (!record || typeof record.snapshot !== "object" || record.snapshot === null) return null;
  return {
    version: typeof record.version === "number" ? record.version : 1,
    snapshot: record.snapshot,
    publishedAt: record.publishedAt ?? new Date().toISOString(),
    publishedBy: record.publishedBy ?? "local-admin",
    notes: record.notes,
  };
}

export function writeLocalPublished(
  snapshot: DraftSnapshot,
  publishedBy = "local-admin",
  notes?: string
): LocalPublishedRecord | null {
  const previous = readLocalPublished();
  const record: LocalPublishedRecord = {
    version: (previous?.version ?? 0) + 1,
    snapshot,
    publishedAt: new Date().toISOString(),
    publishedBy,
    notes,
  };
  return writeJson(PUBLISHED_FILE, record) ? record : null;
}

export type LocalDraftRecord = { snapshot: DraftSnapshot; updatedAt: string };

export function readLocalDraftRecord(): LocalDraftRecord | null {
  const record = readJson<Partial<LocalDraftRecord>>(DRAFT_FILE);
  if (!record?.snapshot || typeof record.snapshot !== "object") return null;
  return { snapshot: record.snapshot, updatedAt: record.updatedAt ?? "" };
}

export function readLocalDraft(): DraftSnapshot | null {
  return readLocalDraftRecord()?.snapshot ?? null;
}

/** Returns the new revision token, or null if the write failed. */
export function writeLocalDraft(snapshot: DraftSnapshot): string | null {
  const updatedAt = new Date().toISOString();
  return writeJson(DRAFT_FILE, { snapshot, updatedAt }) ? updatedAt : null;
}

export function clearLocalGraphs(): void {
  for (const file of [PUBLISHED_FILE, DRAFT_FILE]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      console.warn(`[LocalStore] Failed to remove ${path.basename(file)}:`, err);
    }
  }
}
