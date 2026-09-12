import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { appendAction, listActions } from "@/lib/store";

export const runtime = "nodejs";

// The human approves or rejects an action the agent proposed. Approved journal entries / alert rules are persisted.
export async function POST(req: Request) {
  const body = (await req.json()) as { auditId: string; findingId: string; type: "journal" | "alert"; label: string; decision: "approved" | "rejected" };
  if (!body.auditId || !body.findingId || !body.type || !body.decision) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const entry = { id: randomUUID().slice(0, 8), ts: new Date().toISOString(), ...body };
  await appendAction(entry);
  return NextResponse.json({ ok: true, entry });
}

export async function GET() {
  return NextResponse.json(await listActions());
}
