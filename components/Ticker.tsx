"use client";

import { useEffect, useState } from "react";
import type { Headline } from "@/lib/news";

// Scrolling strip of live headlines for the given instruments. Pauses on hover; each item links out.
export function Ticker({ symbols }: { symbols: string[] }) {
  const [items, setItems] = useState<Headline[] | null>(null);
  const key = symbols.join(",");

  useEffect(() => {
    if (!key) return;
    let alive = true;
    fetch(`/api/news?symbols=${encodeURIComponent(key)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: Headline[]) => { if (alive) setItems(d); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, [key]);

  if (!key || (items && items.length === 0)) return null;

  const row = (items ?? []).map((h, i) => (
    <a key={`${h.url}-${i}`} href={h.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-2 px-5 text-[13px] hover:text-accent">
      <span className="num rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-300">{h.symbol}</span>
      <span className="text-neutral-100">{h.title}</span>
      <span className="text-neutral-500">{h.source}</span>
    </a>
  ));

  return (
    <div className="ticker no-print" aria-label="Market headlines">
      <span className="ticker-label">Markets · via Exa</span>
      <div className="ticker-track">
        {items === null ? (
          <span className="px-5 text-[13px] text-neutral-500 pulse">fetching headlines…</span>
        ) : (
          <div className="ticker-scroll">{row}{row}</div>
        )}
      </div>
    </div>
  );
}
