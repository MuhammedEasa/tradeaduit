import { NextResponse } from "next/server";
import { fetchHeadlines } from "@/lib/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/news?symbols=XAUUSD,EURUSD -> live headlines for the ticker (Exa, cached 30 min server-side)
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (symbols.length === 0) return NextResponse.json([]);
  return NextResponse.json(await fetchHeadlines(symbols));
}
