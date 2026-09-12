// lib/store.ts - audits, CSVs, journal entries and alert rules on top of lib/kv.ts.
// Same functions whether the backend is local files (dev) or Upstash Redis (Vercel / Cloud Run).

import { kv } from "./kv";
import type { AuditStep } from "./types";
import type { AuditOutput } from "./audit";

export type AuditRecord = {
  id: string;
  fileName: string;
  createdAt: string;
  status: "queued" | "running" | "done" | "error";
  mode: "trigger" | "inline";
  runId?: string;            // Trigger.dev run id when mode = trigger
  sourceId?: string;         // set when the audit was started by a connected source, not a manual upload
  sourceName?: string;
  steps: AuditStep[];
  result?: AuditOutput;
  error?: string;
};

const AUDIT = (id: string) => `audit:${id}`;
const CSV = (id: string) => `csv:${id}`;

export async function saveCsv(id: string, csv: string) {
  await kv().set(CSV(id), csv);
}

export async function loadCsv(id: string): Promise<string> {
  const text = await kv().get<string>(CSV(id));
  if (text == null) throw new Error(`No CSV stored for audit ${id}`);
  return text;
}

export async function saveAudit(rec: AuditRecord) {
  await kv().set(AUDIT(rec.id), rec);
}

export async function loadAudit(id: string): Promise<AuditRecord | null> {
  return kv().get<AuditRecord>(AUDIT(id));
}

export async function updateAudit(id: string, patch: Partial<AuditRecord> | ((rec: AuditRecord) => Partial<AuditRecord>)) {
  await kv().withLock(AUDIT(id), async () => {
    const rec = await loadAudit(id);
    if (!rec) return;
    await saveAudit({ ...rec, ...(typeof patch === "function" ? patch(rec) : patch) });
  });
}

export async function appendStep(id: string, step: AuditStep) {
  await updateAudit(id, (rec) => ({ steps: [...rec.steps, step] }));
}

export async function listAudits(): Promise<AuditRecord[]> {
  const keys = await kv().keys("audit:");
  const recs = await Promise.all(keys.map((k) => kv().get<AuditRecord>(k)));
  return recs.filter((r): r is AuditRecord => !!r).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function latestAuditId(): Promise<string | null> {
  return (await listAudits())[0]?.id ?? null;
}

export type ActionEntry = {
  id: string;
  auditId: string;
  findingId: string;
  type: "journal" | "alert";
  label: string;
  decision: "approved" | "rejected";
  ts: string;
};

const listKey = (type: ActionEntry["type"]) => (type === "journal" ? "journal" : "alerts");

export async function appendAction(entry: ActionEntry) {
  const key = listKey(entry.type);
  await kv().withLock(key, async () => {
    const list = (await kv().get<ActionEntry[]>(key)) ?? [];
    list.push(entry);
    await kv().set(key, list);
  });
}

export async function listActions(auditId?: string): Promise<ActionEntry[]> {
  const [journal, alerts] = await Promise.all([kv().get<ActionEntry[]>("journal"), kv().get<ActionEntry[]>("alerts")]);
  const all = [...(journal ?? []), ...(alerts ?? [])];
  return auditId ? all.filter((a) => a.auditId === auditId) : all;
}
