// scripts/sync.ts — local sync agent. Watches a folder where your platform drops history exports
// (MT5: <terminal data folder>/MQL5/Files, or simply your Downloads folder) and pushes every new or
// changed CSV to TradeAudit. Nothing to click: export once from the terminal, the audit starts itself.
//
//   npx tsx scripts/sync.ts <folder> <sourceId> [appUrl]
//   e.g. npx tsx scripts/sync.ts "C:/Users/me/Downloads" k3j9x2ab http://localhost:3000
//
// Create the source first on the home page ("Connect a source" -> Folder) to get the sourceId.

import { readdir, readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

const [folder, sourceId, appUrl = "http://localhost:3000"] = process.argv.slice(2);
if (!folder || !sourceId) {
  console.error("usage: npx tsx scripts/sync.ts <folder> <sourceId> [appUrl]");
  process.exit(1);
}

const seen = new Map<string, number>(); // file -> mtime already pushed
const looksLikeHistory = (name: string) => /\.(csv|tsv|txt)$/i.test(name);

async function push(file: string) {
  const text = await readFile(file, "utf8");
  if (!/profit|pnl|p\/l|symbol/i.test(text.slice(0, 2000))) { console.log(`skip ${path.basename(file)} (no trade columns in header)`); return; }
  const fd = new FormData();
  fd.append("file", new Blob([text], { type: "text/csv" }), path.basename(file));
  const res = await fetch(`${appUrl}/api/sources/${sourceId}/ingest`, { method: "POST", body: fd });
  const json = (await res.json()) as { audited?: boolean; auditId?: string; error?: string };
  if (!res.ok) { console.error(`✗ ${path.basename(file)}: ${json.error}`); return; }
  console.log(json.audited ? `✓ ${path.basename(file)} -> new audit ${appUrl}/dashboard/${json.auditId}` : `= ${path.basename(file)} unchanged since last audit`);
}

async function scan() {
  for (const name of await readdir(folder)) {
    if (!looksLikeHistory(name)) continue;
    const file = path.join(folder, name);
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) continue;
    if (seen.get(file) === s.mtimeMs) continue;
    seen.set(file, s.mtimeMs);
    await push(file).catch((e) => console.error(`✗ ${name}: ${(e as Error).message}`));
  }
}

async function main() {
  console.log(`watching ${folder} for history exports -> ${appUrl} (source ${sourceId})`);
  await scan();
  let timer: NodeJS.Timeout | null = null;
  watch(folder, () => { if (timer) clearTimeout(timer); timer = setTimeout(() => scan().catch(console.error), 800); });
  setInterval(() => scan().catch(console.error), 60_000); // belt and braces on network drives
}
main().catch((e) => { console.error(e); process.exit(1); });
