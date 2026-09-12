import { NextResponse } from "next/server";
import { ingestForSource } from "@/lib/sources";

export const runtime = "nodejs";

// Push endpoint for the folder watcher (scripts/sync.ts): a file appeared locally, hand it to the agent.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  try {
    const r = await ingestForSource(id, await file.text(), file.name);
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
