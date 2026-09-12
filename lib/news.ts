// lib/news.ts — Exa: "what moved <symbol> on <date>?" -> top sources.
// Gives the coaching report real-world context for the trader's worst day. Fails soft: on any error
// or empty result the audit continues without news and the activity feed says so.

import Exa from "exa-js";
import { env } from "./env";

export type NewsSource = { title: string; url: string; snippet: string; publishedDate?: string };
export type NewsResult = { query: string; sources: NewsSource[] };

// Human-readable market name for the query ("XAUUSD" -> "gold XAUUSD").
const SYMBOL_HINTS: Record<string, string> = {
  XAU: "gold", XAG: "silver", NAS: "Nasdaq 100", US30: "Dow Jones", SPX: "S&P 500", US500: "S&P 500",
  BTC: "Bitcoin", ETH: "Ethereum", EUR: "euro", GBP: "pound sterling", JPY: "Japanese yen", USOIL: "crude oil", WTI: "crude oil",
};
export function describeSymbol(symbol: string): string {
  const clean = symbol.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  for (const [k, v] of Object.entries(SYMBOL_HINTS)) if (clean.startsWith(k)) return `${v} ${clean}`;
  return clean;
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export async function fetchNewsForDay(symbol: string, day: string, numResults = 3): Promise<NewsResult> {
  const query = `what moved ${describeSymbol(symbol)} price on ${day}`;
  const apiKey = env("EXA_API_KEY");
  if (!apiKey) return { query, sources: [] };

  const exa = new Exa(apiKey);
  const res = await exa.search(query, {
    numResults,
    type: "auto",
    startPublishedDate: shiftDay(day, -1),
    endPublishedDate: shiftDay(day, +2),
    contents: { highlights: { numSentences: 2, highlightsPerUrl: 1 } },
  });

  const sources: NewsSource[] = (res.results ?? []).map((r) => {
    const hl = (r as { highlights?: string[] }).highlights;
    return {
      title: r.title ?? r.url,
      url: r.url,
      snippet: ((hl && hl[0]) || "").replace(/\s*\.\.\.\s*/g, " ").replace(/\s+/g, " ").slice(0, 320),
      publishedDate: r.publishedDate,
    };
  });
  return { query, sources };
}

// One Exa query per instrument, last 2 days, cached in memory for 30 minutes per symbol set.

export type Headline = { symbol: string; title: string; url: string; publishedDate?: string; source: string };
const cache = new Map<string, { at: number; items: Headline[] }>();
const TTL_MS = 30 * 60 * 1000;

export async function fetchHeadlines(symbols: string[], perSymbol = 3): Promise<Headline[]> {
  const key = symbols.map((s) => s.toUpperCase()).sort().join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;

  const apiKey = env("EXA_API_KEY");
  if (!apiKey) return [];
  const exa = new Exa(apiKey);
  const today = new Date().toISOString().slice(0, 10);
  const results = await Promise.all(symbols.map(async (symbol) => {
    try {
      const res = await exa.search(`${describeSymbol(symbol)} price news today`, {
        numResults: perSymbol,
        type: "auto",
        category: "news",
        startPublishedDate: shiftDay(today, -2),
      });
      return (res.results ?? []).map((r) => ({
        symbol: symbol.toUpperCase(),
        title: (r.title ?? r.url).split(/\s+[|–—-]\s+(?=[A-Z])/)[0].trim().slice(0, 110),   // drop " - Site Name" suffixes
        url: r.url,
        publishedDate: r.publishedDate,
        source: new URL(r.url).hostname.replace(/^www\./, ""),
      }));
    } catch {
      return [] as Headline[];
    }
  }));
  const items = results.flat();
  cache.set(key, { at: Date.now(), items });
  return items;
}
