import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sources";

export const runtime = "nodejs";

// Called by the daily Trigger.dev schedule: pull every connected source, audit the ones that changed.
export async function POST() {
  const sources = await syncAll();
  return NextResponse.json({ checked: sources.length, newAudits: sources.filter((s) => s.lastOutcome === "new-audit").length, sources });
}
