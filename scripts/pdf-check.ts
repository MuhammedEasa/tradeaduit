// Generates the audit PDF from a real audit and reports what landed in it.
// Run: npx tsx scripts/pdf-check.ts <audit-url-or-id> [baseUrl]

import { writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { buildAuditPdf, pdfFileName } from "../lib/pdf";

async function main() {
  const id = process.argv[2] ?? "";
  const base = process.argv[3] ?? "https://tradeaduit.vercel.app";
  const res = await fetch(`${base}/api/audit/${id}`);
  if (!res.ok) throw new Error(`audit ${id}: HTTP ${res.status}`);
  const d = (await res.json()) as { fileName: string; createdAt: string; sourceName?: string; result?: Parameters<typeof buildAuditPdf>[1]["result"] };
  if (!d.result) throw new Error("audit has no result yet");

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  buildAuditPdf(doc, { fileName: d.fileName, createdAt: d.createdAt, sourceName: d.sourceName, result: d.result });

  const name = pdfFileName(d.fileName, d.createdAt);
  const bytes = Buffer.from(doc.output("arraybuffer") as ArrayBuffer);
  writeFileSync(name, bytes);

  const pages = doc.getNumberOfPages();
  const text = bytes.toString("latin1");
  const checks: [string, boolean][] = [
    ["file is a PDF", text.startsWith("%PDF")],
    ["has pages", pages > 0],
    ["not empty (>8KB)", bytes.length > 8_000],
    ["has text operators", /\(.*\)\s*Tj/.test(text) || text.includes("TJ")],
  ];
  console.log(`wrote ${name}  ${(bytes.length / 1024).toFixed(1)} KB  ${pages} pages`);
  for (const [label, ok] of checks) console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`  findings rendered: ${d.result.findings.length}`);
  console.log(`  sources rendered:  ${d.result.news.reduce((a, n) => a + n.sources.length, 0)}`);
  console.log(`  report words:      ${d.result.report.split(/\s+/).length}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
