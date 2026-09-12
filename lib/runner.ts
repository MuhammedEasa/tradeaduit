// lib/runner.ts — starts an audit (Trigger.dev when configured, inline otherwise) and reads its live state.
// The dashboard only ever talks to this module through the API routes.

import { randomUUID } from "node:crypto";
import { env } from "./env";
import { tasks, runs } from "@trigger.dev/sdk";
import { runAudit, type AuditOutput, type PreviousSummary } from "./audit";
import { parseTrades } from "./parse";
import { appendStep, loadAudit, loadCsv, saveAudit, saveCsv, updateAudit, type AuditRecord } from "./store";
import type { AuditStep, Trade } from "./types";
import type { auditTask } from "../trigger/audit";

const triggerConfigured = () =>
  !!env("TRIGGER_SECRET_KEY") && !!env("TRIGGER_PROJECT_REF") && process.env.AUDIT_MODE !== "inline";

export function summarize(rec: AuditRecord | AuditView | null): PreviousSummary | null {
  if (!rec) return null;
  const m = rec.result?.metrics;
  if (!m || !rec.result) return null;
  return {
    auditId: rec.id, createdAt: rec.createdAt, totalTrades: m.totalTrades, totalPnL: m.totalPnL, winRate: m.winRate, score: m.score.total,
    findings: rec.result.findings.filter((f) => f.id !== "progress").map((f) => ({ id: f.id, title: f.title, stat: f.stat })),
  };
}

export async function startAudit(csv: string, fileName: string, source?: { sourceId: string; sourceName: string; previousAuditId?: string }): Promise<AuditRecord> {
  const id = randomUUID().slice(0, 8);
  await saveCsv(id, csv);
  const { previousAuditId, ...sourceInfo } = source ?? {};
  const rec: AuditRecord = { id, fileName, createdAt: new Date().toISOString(), status: "queued", mode: "inline", steps: [], ...sourceInfo };
  // getAudit (not loadAudit): a Trigger.dev run only lands in storage once someone reads it, and the
  // previous audit may never have been opened in the browser.
  const previous = previousAuditId ? summarize(await getAudit(previousAuditId)) : null;

  if (triggerConfigured()) {
    try {
      const handle = await tasks.trigger<typeof auditTask>("audit-csv", { auditId: id, csv, fileName, previous });
      rec.mode = "trigger";
      rec.runId = handle.id;
      await saveAudit(rec);
      return rec;
    } catch (err) {
      rec.steps.push({ name: "Trigger.dev", status: "error", detail: `Could not enqueue job (${(err as Error).message.slice(0, 80)}); running inline`, ts: new Date().toISOString() });
    }
  }

  // Inline fallback: run in the background of this server process, persisting each step.
  await saveAudit(rec);
  void (async () => {
    await updateAudit(id, { status: "running" });
    try {
      const out = await runAudit(csv, (step) => appendStep(id, step), { previous });
      const { trades: _t, ...result } = out;
      await updateAudit(id, { status: "done", result, steps: out.steps });
    } catch (err) {
      await updateAudit(id, { status: "error", error: (err as Error).message });
    }
  })();
  return rec;
}

export type AuditView = {
  id: string;
  fileName: string;
  createdAt: string;
  status: AuditRecord["status"];
  mode: AuditRecord["mode"];
  runId?: string;
  sourceId?: string;
  sourceName?: string;
  steps: AuditStep[];
  result?: AuditOutput;
  trades?: Trade[];
  error?: string;
};

export async function getAudit(id: string): Promise<AuditView | null> {
  const rec = await loadAudit(id);
  if (!rec) return null;
  const view: AuditView = { ...rec };

  if (rec.mode === "trigger" && rec.runId && rec.status !== "done") {
    try {
      const run = await runs.retrieve<typeof auditTask>(rec.runId);
      const meta = (run.metadata ?? {}) as { steps?: AuditStep[] };
      view.steps = [...rec.steps, ...(meta.steps ?? [])];
      if (run.status === "COMPLETED" && run.output) {
        view.status = "done";
        view.result = run.output;
        await updateAudit(id, { status: "done", result: run.output, steps: view.steps });
      } else if (["FAILED", "CRASHED", "CANCELED", "SYSTEM_FAILURE", "TIMED_OUT"].includes(run.status)) {
        view.status = "error";
        view.error = run.error?.message ?? run.status;
      } else if (run.status === "EXECUTING") {
        view.status = "running";
        if ((run.attemptCount ?? 1) > 1 && !view.steps.some((s) => s.name === "Trigger.dev retry")) {
          view.steps.push({ name: "Trigger.dev retry", status: "running", detail: `attempt ${run.attemptCount}`, ts: new Date().toISOString() });
        }
      }
    } catch (err) {
      view.steps = [...rec.steps, { name: "Trigger.dev", status: "error", detail: `poll failed: ${(err as Error).message.slice(0, 80)}`, ts: new Date().toISOString() }];
    }
  }

  if (view.status === "done") {
    try {
      view.trades = parseTrades(await loadCsv(id)).trades;
    } catch { /* csv missing: table just stays empty */ }
  }
  return view;
}
