// lib/audit.ts — the agent's pipeline: parse -> metrics -> findings -> tag -> news -> report.
// Runs the same whether called inline (API route) or inside the Trigger.dev task; every step reports
// progress through `onStep` so the dashboard can show a live activity feed. External calls (Exa, LLM)
// retry with backoff and fail soft: the audit always produces metrics + findings even if the network dies.

import { parseTrades } from "./parse";
import { computeMetrics, type MetricsPlus } from "./metrics";
import { detectFindings } from "./findings";
import { fetchNewsForDay, type NewsResult } from "./news";
import { tagFindings, writeReport, type FindingTag } from "./llm";
import type { AuditStep, Finding, Trade } from "./types";

export type AuditOutput = {
  parse: { profile: string; dropped: number; warnings: string[]; tradeCount: number };
  metrics: MetricsPlus;
  findings: Finding[];
  tags: Record<string, FindingTag>;
  news: NewsResult[];
  report: string;
  steps: AuditStep[];
  highlightedTradeIds: string[];   // what the agent marks up on the dashboard
  appliedFilter: { session?: "asian" | "london" | "ny"; exitReason?: "sl" | "tp" | "manual" } | null;
};

export type StepSink = (step: AuditStep) => void | Promise<void>;

const now = () => new Date().toISOString();

async function withRetry<T>(name: string, fn: () => Promise<T>, log: StepSink, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      await log({ name, status: "error", detail: `attempt ${i}/${attempts} failed: ${msg.slice(0, 120)}${i < attempts ? " - retrying" : ""}`, ts: now() });
      if (i < attempts) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

export async function runAudit(csvText: string, onStep: StepSink = () => {}): Promise<AuditOutput & { trades: Trade[] }> {
  const steps: AuditStep[] = [];
  const log: StepSink = async (s) => { steps.push(s); await onStep(s); };

  // 1. parse
  await log({ name: "Parse history", status: "running", ts: now() });
  const parsed = parseTrades(csvText);
  if (parsed.trades.length === 0) {
    await log({ name: "Parse history", status: "error", detail: parsed.warnings.join("; ") || "No trades found", ts: now() });
    throw new Error("No trades could be parsed from this file");
  }
  await log({
    name: "Parse history", status: "done", ts: now(),
    detail: `Detected ${parsed.profile} export: ${parsed.trades.length} closed trades, ${parsed.dropped.toLocaleString()} non-trade rows skipped` + (parsed.warnings.length ? ` (${parsed.warnings.join("; ")})` : ""),
  });

  // 2. metrics
  await log({ name: "Compute metrics", status: "running", ts: now() });
  const metrics = computeMetrics(parsed.trades);
  await log({
    name: "Compute metrics", status: "done", ts: now(),
    detail: `Net ${metrics.totalPnL >= 0 ? "+" : ""}${metrics.totalPnL.toFixed(2)} over ${metrics.totalTrades} trades, ${metrics.winRate}% win rate, profit factor ${metrics.profitFactor}, max drawdown ${metrics.maxDrawdown.toFixed(2)}`,
  });

  // 3. findings
  await log({ name: "Detect patterns", status: "running", ts: now() });
  const findings = detectFindings(parsed.trades, metrics);
  await log({
    name: "Detect patterns", status: "done", ts: now(),
    detail: findings.length ? `${findings.length} findings. Top: ${findings[0].title}` : "No significant patterns found",
  });

  // 4. tag (cheap model via OpenRouter) - optional
  let tags: Record<string, FindingTag> = {};
  await log({ name: "Classify findings", status: "running", detail: "OpenRouter -> gpt-4o-mini", ts: now() });
  try {
    tags = await withRetry("Classify findings", () => tagFindings(findings), log, 2);
    await log({ name: "Classify findings", status: "done", detail: Object.entries(tags).map(([k, v]) => `${k}=${v}`).join(", "), ts: now() });
  } catch {
    await log({ name: "Classify findings", status: "done", detail: "Skipped (LLM unavailable); findings left untagged", ts: now() });
  }

  // 5. news for the worst day (Exa) - optional
  const news: NewsResult[] = [];
  const worst = metrics.worstDay;
  const worstSymbol = Object.entries(metrics.bySymbol).sort((a, b) => a[1].pnl - b[1].pnl)[0]?.[0] ?? parsed.trades[0].symbol;
  if (worst && worst.pnl < 0) {
    const daySymbol = parsed.trades.filter((t) => t.closeTime.startsWith(worst.day)).sort((a, b) => a.profit - b.profit)[0]?.symbol ?? worstSymbol;
    await log({ name: "Fetch news", status: "running", detail: `Exa: what moved ${daySymbol} on ${worst.day}?`, ts: now() });
    try {
      const n = await withRetry("Fetch news", () => fetchNewsForDay(daySymbol, worst.day), log, 3);
      news.push(n);
      await log({
        name: "Fetch news", status: "done", ts: now(),
        detail: n.sources.length ? `${n.sources.length} sources: ${n.sources.map((s) => s.title).join(" | ").slice(0, 160)}` : "No news found for that day",
      });
    } catch {
      await log({ name: "Fetch news", status: "done", detail: "News lookup failed; continuing without it", ts: now() });
    }
  }

  // 6. report (strong model via OpenRouter) - optional, falls back to a computed summary
  await log({ name: "Write report", status: "running", detail: "OpenRouter -> gpt-4o, from computed numbers only", ts: now() });
  let report = "";
  try {
    report = await withRetry("Write report", () => writeReport({ metrics, findings, tags, news, profile: parsed.profile }), log, 2);
    await log({ name: "Write report", status: "done", detail: `${report.split(/\s+/).length} words`, ts: now() });
  } catch {
    report = fallbackReport(metrics, findings);
    await log({ name: "Write report", status: "done", detail: "LLM unavailable; using computed summary", ts: now() });
  }

  // 7. mark up the dashboard: highlight the top finding's trades, apply a filter that shows them
  const top = findings[0];
  const highlightedTradeIds = top?.tradeIds.slice(0, 500) ?? [];
  const appliedFilter = top?.id === "manual-exits" ? { exitReason: "manual" as const }
    : top?.id === "sl-vs-tp" ? { exitReason: "sl" as const }
    : top?.id === "worst-session" ? { session: sessionFromTitle(top.title) }
    : null;
  await log({
    name: "Mark up dashboard", status: "done", ts: now(),
    detail: top ? `Highlighted ${highlightedTradeIds.length} trades behind "${top.title}"${appliedFilter ? `, filter applied: ${JSON.stringify(appliedFilter)}` : ""}` : "Nothing to highlight",
  });

  return {
    parse: { profile: parsed.profile, dropped: parsed.dropped, warnings: parsed.warnings, tradeCount: parsed.trades.length },
    trades: parsed.trades,
    metrics, findings, tags, news, report, steps, highlightedTradeIds, appliedFilter,
  };
}

function sessionFromTitle(title: string): "asian" | "london" | "ny" | undefined {
  const t = title.toLowerCase();
  return t.includes("asian") ? "asian" : t.includes("london") ? "london" : t.includes("new york") ? "ny" : undefined;
}

// Used when the LLM is unreachable: still a readable report, still only computed numbers.
export function fallbackReport(m: MetricsPlus, findings: Finding[]): string {
  const lines = [
    "## Verdict",
    findings[0] ? `${findings[0].title}. ${findings[0].evidence}` : "No significant behavioural patterns were detected.",
    "",
    "## What the numbers say",
    `- ${m.totalTrades} trades, net ${m.totalPnL.toFixed(2)}, win rate ${m.winRate}%, profit factor ${m.profitFactor}`,
    `- Average win ${m.avgWin.toFixed(2)} vs average loss ${m.avgLoss.toFixed(2)}; max drawdown ${m.maxDrawdown.toFixed(2)}`,
    `- Exits: ${m.byExitReason.sl.count} stop-loss, ${m.byExitReason.tp.count} take-profit, ${m.byExitReason.manual.count} manual`,
    "",
    "## Findings",
    ...findings.map((f) => `- **${f.title}** (${f.severity}): ${f.evidence}${f.suggestedAction ? ` **${f.suggestedAction.label}**` : ""}`),
  ];
  return lines.join("\n");
}
