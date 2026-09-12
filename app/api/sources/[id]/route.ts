import { NextResponse } from "next/server";
import { removeSource } from "@/lib/sources";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await removeSource(id);
  return NextResponse.json({ ok: true });
}
