import { NextResponse } from "next/server";
import { startAudit } from "@/lib/runner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "File too large (10 MB max)" }, { status: 413 });
  const csv = await file.text();
  const rec = await startAudit(csv, file.name);
  return NextResponse.json({ id: rec.id, mode: rec.mode, runId: rec.runId });
}
