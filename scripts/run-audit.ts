// scripts/run-audit.ts - run the whole agent pipeline locally (real Exa + OpenRouter calls).
// Run: npx tsx --env-file=.env scripts/run-audit.ts [file.csv]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { runAudit } from "../lib/audit";

const file = process.argv[2] ?? "sample.history.csv";
async function main() {
const t0 = Date.now();
const out = await runAudit(readFileSync(file, "utf8"), (s) => {
  console.log(`[${s.status.padEnd(7)}] ${s.name}${s.detail ? " - " + s.detail : ""}`);
});
console.log(`\n--- done in ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
console.log("news:", JSON.stringify(out.news, null, 1));
console.log("\n--- REPORT ---\n" + out.report);
mkdirSync("data", { recursive: true });
const { trades, ...rest } = out;
writeFileSync("data/last-audit.json", JSON.stringify(rest, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
