import { NextResponse } from "next/server";
import { latestAuditId, loadAudit, loadCsv } from "@/lib/store";
import { startAudit } from "@/lib/runner";

export const runtime = "nodejs";

// Called by the daily Trigger.dev schedule: re-audit the most recent upload.
export async function POST() {
  const id = await latestAuditId();
  if (!id) return NextResponse.json({ error: "Nothing to re-run" }, { status: 404 });
  const prev = await loadAudit(id);
  const rec = await startAudit(await loadCsv(id), prev?.fileName ?? "history.csv");
  return NextResponse.json({ id: rec.id, rerunOf: id });
}
