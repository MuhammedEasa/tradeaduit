import { NextResponse } from "next/server";
import { addSource, listSources } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listSources());
}

// Connect a source once; from then on the agent pulls it itself.
export async function POST(req: Request) {
  const body = (await req.json()) as { name?: string; kind?: "url" | "folder"; url?: string };
  const kind = body.kind ?? "url";
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (kind === "url" && !/^https?:\/\//.test(body.url ?? "")) return NextResponse.json({ error: "url must start with http(s)://" }, { status: 400 });
  const src = await addSource({ name: body.name, kind, url: body.url });
  return NextResponse.json(src);
}
