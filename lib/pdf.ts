// Builds the audit PDF from the computed data, not from a screenshot of the page.
// Screen-capture PDFs break on modern CSS and produce an image nobody can select or search;
// drawing from the data gives real text, small files and identical output everywhere.

import type { jsPDF } from "jspdf";
import type { AuditOutput } from "./audit";

type Doc = jsPDF;

const INK = [10, 10, 10] as const;
const MUTED = [115, 115, 115] as const;
const RULE = [225, 225, 225] as const;
const GOOD = [30, 142, 62] as const;
const BAD = [217, 48, 37] as const;
const WARN = [178, 106, 0] as const;

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Markdown -> plain text: the PDF sets its own type, so the markers are noise.
function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*]\s+/gm, "- ")
    .trim();
}

export type PdfInput = {
  fileName: string;
  createdAt: string;
  sourceName?: string;
  result: AuditOutput;
};

export function buildAuditPdf(doc: Doc, input: PdfInput): Doc {
  const { result: r } = input;
  const m = r.metrics;
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 16;
  const R = W - 16;
  let y = 0;

  const setColor = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const font = (size: number, weight: "normal" | "bold" = "normal", color: readonly number[] = INK) => {
    doc.setFont("helvetica", weight);
    doc.setFontSize(size);
    setColor(color);
  };

  function footer(page: number) {
    font(7.5, "normal", MUTED);
    doc.text("Every figure in this report was computed from the trade history. The language model wrote no numbers.", L, H - 9);
    doc.text(String(page), R, H - 9, { align: "right" });
  }

  let page = 1;
  function newPage() {
    footer(page);
    doc.addPage();
    page++;
    y = 18;
  }
  function space(needed: number) {
    if (y + needed > H - 16) newPage();
  }
  function rule() {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.2);
    doc.line(L, y, R, y);
    y += 5;
  }
  function heading(text: string) {
    space(14);
    font(8, "bold", MUTED);
    doc.text(text.toUpperCase(), L, y);
    y += 2;
    rule();
  }
  function paragraph(text: string, size = 9.5, color: readonly number[] = INK, indent = 0) {
    font(size, "normal", color);
    for (const line of doc.splitTextToSize(text, R - L - indent) as string[]) {
      space(6);
      doc.text(line, L + indent, y);
      y += size * 0.46;
    }
  }

  // ---- header ----
  y = 20;
  font(20, "bold");
  doc.text("TradeAudit", L, y);
  font(9, "normal", MUTED);
  doc.text("Trading behaviour report", R, y, { align: "right" });
  y += 7;
  font(9, "normal", MUTED);
  doc.text(
    `${input.fileName}${input.sourceName ? ` · auto-synced from ${input.sourceName}` : ""} · ${r.parse.tradeCount} trades · ${m.dateRange.from.slice(0, 10)} to ${m.dateRange.to.slice(0, 10)}`,
    L, y,
  );
  y += 4;
  doc.text(`Generated ${new Date(input.createdAt).toLocaleString("en-GB")} · ${r.parse.profile} export, ${r.parse.dropped.toLocaleString()} non-trade rows skipped`, L, y);
  y += 6;
  rule();

  // ---- headline numbers ----
  const tiles: [string, string, readonly number[]][] = [
    ["Net P&L", money(m.totalPnL), m.totalPnL >= 0 ? GOOD : BAD],
    ["Trades", String(m.totalTrades), INK],
    ["Win rate", `${m.winRate}%`, INK],
    ["Profit factor", String(m.profitFactor), INK],
    ["Max drawdown", money(-m.maxDrawdown), BAD],
    ["Per trade", money(m.expectancy), m.expectancy >= 0 ? GOOD : BAD],
  ];
  const colW = (R - L) / tiles.length;
  tiles.forEach(([label, value, color], i) => {
    const x = L + i * colW;
    font(7, "normal", MUTED);
    doc.text(label.toUpperCase(), x, y + 4);
    font(12, "bold", color);
    doc.text(value, x, y + 11);
  });
  y += 17;

  // ---- score ----
  font(9.5, "normal", INK);
  const g = m.score.grades;
  doc.text(`Score ${m.score.total}/100`, L, y);
  font(9.5, "normal", MUTED);
  doc.text(`Profitability ${g.profitability}   ·   Risk ${g.risk}   ·   Drawdown ${g.drawdown}   ·   Consistency ${g.consistency}`, L + 32, y);
  y += 6;
  rule();

  // ---- findings ----
  heading(`What the agent found (${r.findings.length})`);
  r.findings.forEach((f, i) => {
    space(20);
    const sev = f.severity === "high" ? BAD : f.severity === "medium" ? WARN : MUTED;
    font(7.5, "bold", sev);
    doc.text(`${String(i + 1).padStart(2, "0")}  ${f.severity.toUpperCase()}${r.tags[f.id] ? `  ·  ${r.tags[f.id].toUpperCase()}` : ""}`, L, y);
    if (f.stat) {
      font(10, "bold", sev);
      doc.text(f.stat.value, R, y, { align: "right" });
    }
    y += 5;
    font(10.5, "bold", INK);
    for (const line of doc.splitTextToSize(f.title, R - L - 24) as string[]) {
      space(6);
      doc.text(line, L, y);
      y += 5;
    }
    paragraph(f.evidence, 9, MUTED);
    if (f.suggestedAction) {
      y += 1.5;
      paragraph(`Proposed: ${f.suggestedAction.label}`, 9, INK);
    }
    y += 5;
  });

  // ---- coaching report ----
  const report = plain(r.report);
  if (report) {
    heading("Coach's verdict");
    for (const block of report.split(/\n{2,}/)) {
      const t = block.trim();
      if (!t) continue;
      // Short unpunctuated lines are the markdown section titles; set them as subheads.
      if (t.length < 60 && !t.includes(".") && !t.startsWith("-")) {
        space(10);
        font(9.5, "bold", INK);
        doc.text(t, L, y);
        y += 5.5;
      } else {
        paragraph(t, 9.5, INK);
        y += 3;
      }
    }
  }

  // ---- sources ----
  const sources = r.news.flatMap((n) => n.sources);
  if (sources.length) {
    heading("What moved the market on the worst day (via Exa)");
    for (const s of sources) {
      space(12);
      font(9, "bold", INK);
      for (const line of doc.splitTextToSize(s.title, R - L) as string[]) {
        space(6);
        doc.text(line, L, y);
        y += 4.4;
      }
      font(7.5, "normal", MUTED);
      doc.text(s.url.slice(0, 110), L, y);
      y += 6;
    }
  }

  footer(page);
  return doc;
}

export const pdfFileName = (fileName: string, createdAt: string) =>
  `tradeaudit-${fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-]+/g, "-").toLowerCase()}-${createdAt.slice(0, 10)}.pdf`;
