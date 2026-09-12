// lib/store.ts — tiny JSON-on-disk store for audits, journal entries and alert rules.
// Good enough for a single-user demo; swap for SQLite/Postgres by replacing these functions.

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AuditStep } from "./types";
import type { AuditOutput } from "./audit";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const AUDITS = path.join(DATA_DIR, "audits");

export type AuditRecord = {
  id: string;
  fileName: string;
  createdAt: string;
  status: "queued" | "running" | "done" | "error";
  mode: "trigger" | "inline";
  runId?: string;            // Trigger.dev run id when mode = trigger
  steps: AuditStep[];
  result?: AuditOutput;
  error?: string;
};

async function ensure() {
  await mkdir(AUDITS, { recursive: true });
}

export async function saveCsv(id: string, csv: string) {
  await ensure();
  await writeFile(path.join(AUDITS, `${id}.csv`), csv, "utf8");
}

export async function loadCsv(id: string): Promise<string> {
  return readFile(path.join(AUDITS, `${id}.csv`), "utf8");
}

export async function saveAudit(rec: AuditRecord) {
  await ensure();
  await writeFile(path.join(AUDITS, `${rec.id}.json`), JSON.stringify(rec), "utf8");
}

export async function loadAudit(id: string): Promise<AuditRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(AUDITS, `${id}.json`), "utf8")) as AuditRecord;
  } catch {
    return null;
  }
}

export async function updateAudit(id: string, patch: Partial<AuditRecord>) {
  const rec = await loadAudit(id);
  if (!rec) return;
  await saveAudit({ ...rec, ...patch });
}

export async function latestAuditId(): Promise<string | null> {
  await ensure();
  const files = (await readdir(AUDITS)).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;
  const recs = await Promise.all(files.map((f) => loadAudit(f.replace(/\.json$/, ""))));
  return recs.filter(Boolean).sort((a, b) => b!.createdAt.localeCompare(a!.createdAt))[0]?.id ?? null;
}

// ---- actions the human approves ----

export type ActionEntry = {
  id: string;
  auditId: string;
  findingId: string;
  type: "journal" | "alert";
  label: string;
  decision: "approved" | "rejected";
  ts: string;
};

async function readList(name: string): Promise<ActionEntry[]> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${name}.json`), "utf8")) as ActionEntry[];
  } catch {
    return [];
  }
}

export async function appendAction(entry: ActionEntry) {
  await ensure();
  const name = entry.type === "journal" ? "journal" : "alerts";
  const list = await readList(name);
  list.push(entry);
  await writeFile(path.join(DATA_DIR, `${name}.json`), JSON.stringify(list, null, 1), "utf8");
}

export async function listActions(auditId?: string): Promise<ActionEntry[]> {
  const all = [...(await readList("journal")), ...(await readList("alerts"))];
  return auditId ? all.filter((a) => a.auditId === auditId) : all;
}
