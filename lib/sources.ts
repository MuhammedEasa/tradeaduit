// lib/sources.ts — connected data sources. Register a place where your history export lives once;
// the agent fetches it on its own (daily schedule or "sync now"), hashes it, and only runs a new
// audit when the file actually changed. No manual uploads after the first setup.
//
// Kinds: "url" = any direct link to a CSV (broker web report, Dropbox/Drive direct link, S3, GitHub raw).
// The folder watcher (scripts/sync.ts) is the local counterpart for MT5 terminals: it pushes new files here.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { startAudit } from "./runner";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "sources.json");

export type Source = {
  id: string;
  name: string;
  kind: "url" | "folder";
  url?: string;                 // for kind = url
  createdAt: string;
  lastCheckedAt?: string;
  lastHash?: string;
  lastAuditId?: string;
  lastOutcome?: "new-audit" | "unchanged" | "error";
  lastError?: string;
  syncCount: number;
};

async function readAll(): Promise<Source[]> {
  try { return JSON.parse(await readFile(FILE, "utf8")) as Source[]; } catch { return []; }
}
async function writeAll(list: Source[]) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 1), "utf8");
  await rename(tmp, FILE);
}

export const listSources = readAll;

export async function addSource(input: { name: string; kind: Source["kind"]; url?: string }): Promise<Source> {
  const list = await readAll();
  const src: Source = { id: Math.random().toString(36).slice(2, 10), createdAt: new Date().toISOString(), syncCount: 0, ...input };
  list.push(src);
  await writeAll(list);
  return src;
}

export async function removeSource(id: string) {
  await writeAll((await readAll()).filter((s) => s.id !== id));
}

export const hashOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

async function patch(id: string, p: Partial<Source>) {
  const list = await readAll();
  const i = list.findIndex((s) => s.id === id);
  if (i >= 0) { list[i] = { ...list[i], ...p }; await writeAll(list); return list[i]; }
  return null;
}

// Pull the file, compare with what we audited last time, audit only if it changed.
export async function syncSource(id: string, opts: { force?: boolean } = {}): Promise<Source | null> {
  const src = (await readAll()).find((s) => s.id === id);
  if (!src) return null;
  const checkedAt = new Date().toISOString();
  try {
    let text: string;
    if (src.kind === "url" && src.url) {
      const res = await fetch(src.url, { headers: { "user-agent": "TradeAudit/1.0" }, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
      if (text.length < 50 || /<html/i.test(text.slice(0, 500))) throw new Error("URL did not return a CSV (got HTML or empty)");
    } else {
      throw new Error("Folder sources are pushed by scripts/sync.ts, not pulled");
    }
    const hash = hashOf(text);
    if (!opts.force && hash === src.lastHash) {
      return patch(id, { lastCheckedAt: checkedAt, lastOutcome: "unchanged", lastError: undefined });
    }
    const rec = await startAudit(text, `${src.name}.csv`, { sourceId: src.id, sourceName: src.name });
    return patch(id, { lastCheckedAt: checkedAt, lastHash: hash, lastAuditId: rec.id, lastOutcome: "new-audit", lastError: undefined, syncCount: src.syncCount + 1 });
  } catch (err) {
    return patch(id, { lastCheckedAt: checkedAt, lastOutcome: "error", lastError: (err as Error).message.slice(0, 200) });
  }
}

// Used by the folder watcher: a file arrived, audit it if it is new content for this source.
export async function ingestForSource(id: string, text: string, fileName: string): Promise<{ audited: boolean; auditId?: string }> {
  const src = (await readAll()).find((s) => s.id === id);
  if (!src) throw new Error("Unknown source");
  const hash = hashOf(text);
  if (hash === src.lastHash) { await patch(id, { lastCheckedAt: new Date().toISOString(), lastOutcome: "unchanged" }); return { audited: false, auditId: src.lastAuditId }; }
  const rec = await startAudit(text, fileName, { sourceId: src.id, sourceName: src.name });
  await patch(id, { lastCheckedAt: new Date().toISOString(), lastHash: hash, lastAuditId: rec.id, lastOutcome: "new-audit", syncCount: src.syncCount + 1 });
  return { audited: true, auditId: rec.id };
}

export async function syncAll(): Promise<Source[]> {
  const out: Source[] = [];
  for (const s of await readAll()) {
    if (s.kind !== "url") { out.push(s); continue; }
    const r = await syncSource(s.id);
    if (r) out.push(r);
  }
  return out;
}
