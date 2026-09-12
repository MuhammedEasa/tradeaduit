// trigger/audit.ts - the agent's spine. A durable Trigger.dev task runs the audit pipeline,
// streams each step into run metadata (the dashboard polls it for the live activity feed),
// retries on failure, and a scheduled task re-runs the latest audit every day.

import { task, schedules, metadata, logger } from "@trigger.dev/sdk";
import { runAudit, type AuditOutput } from "../lib/audit";
import type { AuditStep } from "../lib/types";

export type AuditPayload = { auditId: string; csv: string; fileName: string };

export const auditTask = task({
  id: "audit-csv",
  maxDuration: 300,
  retry: { maxAttempts: 3 },
  run: async (payload: AuditPayload): Promise<AuditOutput> => {
    const steps: AuditStep[] = [];
    logger.info("audit start", { auditId: payload.auditId, fileName: payload.fileName, bytes: payload.csv.length });

    const out = await runAudit(payload.csv, async (step) => {
      steps.push(step);
      metadata.set("steps", steps);
      logger.info(`${step.status}: ${step.name}`, { detail: step.detail });
    });

    // Trades are re-parsed by the app from the stored CSV; keep the run output small.
    const { trades: _trades, ...result } = out;
    return result;
  },
});

// Daily re-audit: asks the app to re-run its most recent upload so the coaching stays current.
export const dailyReaudit = schedules.task({
  id: "daily-reaudit",
  cron: "0 6 * * *",
  run: async () => {
    const base = process.env.APP_URL ?? "http://localhost:3000";
    const res = await fetch(`${base}/api/rerun`, { method: "POST" });
    logger.info("daily re-audit requested", { status: res.status });
    return { status: res.status };
  },
});
