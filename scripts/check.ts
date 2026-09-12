// scripts/check.ts — sanity-check the parser on the real sample file.
// Run: npx tsx scripts/check.ts [path/to/file.csv]

import { readFileSync } from "node:fs";
import { parseTrades } from "../lib/parse";

const file = process.argv[2] ?? "sample.history.csv";
const raw = readFileSync(file, "utf8");
const { trades, profile, dropped, warnings } = parseTrades(raw);

console.log(`file:      ${file}`);
console.log(`profile:   ${profile}`);
console.log(`trades:    ${trades.length}`);
console.log(`dropped:   ${dropped}`);
console.log(`warnings:  ${warnings.length ? warnings.join(" | ") : "none"}`);

const count = (items: string[]) =>
  items.reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});

console.log("\nexit reason:", count(trades.map((t) => t.exitReason)));
console.log("direction:  ", count(trades.map((t) => t.type)));

const bySymbol = trades.reduce<Record<string, { count: number; pnl: number }>>((acc, t) => {
  const s = (acc[t.symbol] ??= { count: 0, pnl: 0 });
  s.count++;
  s.pnl += t.profit;
  return acc;
}, {});
console.log("\nby symbol:");
for (const [sym, s] of Object.entries(bySymbol).sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${sym.padEnd(8)} ${String(s.count).padStart(4)} trades  pnl ${s.pnl.toFixed(2)}`);
}

const totalPnL = trades.reduce((a, t) => a + t.profit, 0);
console.log(`\ntotal profit (sum of Profit column): ${totalPnL.toFixed(2)}`);
console.log(`date range: ${trades[0]?.openTime} -> ${trades[trades.length - 1]?.openTime}`);

console.log("\nhand-check: first 3 trades chronologically (compare against raw file):");
for (const t of trades.slice(0, 3)) console.log(" ", JSON.stringify(t));
console.log("\nhand-check: newest trade (= first Buy/Sell row in the raw file):");
console.log(" ", JSON.stringify(trades[trades.length - 1]));

// ---------- metrics + findings ----------
import { computeMetrics } from "../lib/metrics";
import { detectFindings } from "../lib/findings";

const m = computeMetrics(trades);
console.log("\n================ METRICS ================");
const { byDay, byHour, bySymbol: bs, ...rest } = m;
console.log(JSON.stringify(rest, null, 1));
console.log("byHour:", Object.entries(byHour).map(([h, v]) => `${h}h ${v.count}t ${v.pnl}`).join(" | "));
console.log("days:", Object.keys(byDay).length, " worst:", m.worstDay, " best:", m.bestDay);

const f = detectFindings(trades, m);
console.log("\n================ FINDINGS ================");
for (const x of f) {
  console.log(`\n[${x.severity.toUpperCase()}] ${x.title}  (${x.tradeIds.length} trades)`);
  console.log("   " + x.evidence);
  if (x.suggestedAction) console.log("   -> " + x.suggestedAction.label);
}
