import { NextResponse } from "next/server";
import { syncSource } from "@/lib/sources";

export const runtime = "nodejs";

// "Sync now": fetch the source, audit if the file changed. ?force=1 audits even if unchanged.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const force = new URL(req.url).searchParams.get("force") === "1";
  const src = await syncSource(id, { force });
  if (!src) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(src);
}
