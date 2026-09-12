import { NextResponse } from "next/server";
import { getAudit } from "@/lib/runner";
import { listActions } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const view = await getAudit(id);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const actions = await listActions(id);
  return NextResponse.json({ ...view, actions });
}
