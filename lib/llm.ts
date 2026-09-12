// lib/llm.ts — OpenRouter client (OpenAI models behind it).
// Two jobs, two price points:
//   - cheap model  : tag each finding with a category (discipline / risk / timing / execution)
//   - strong model : write the coaching report FROM the computed metrics + findings + news ONLY.
// The LLM never sees the raw trades and is told not to compute or invent numbers.

import OpenAI from "openai";
import type { Finding } from "./types";
import type { MetricsPlus } from "./metrics";
import type { NewsResult } from "./news";
import { env } from "./env";

export const MODELS = {
  cheap: env("LLM_CHEAP_MODEL") || "openai/gpt-4o-mini",
  strong: env("LLM_STRONG_MODEL") || "openai/gpt-4o",
};

function client(): OpenAI {
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  return new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://github.com/MuhammedEasa/tradeaduit", "X-Title": "TradeAudit" },
  });
}

export type FindingTag = "discipline" | "risk" | "timing" | "execution";
const TAGS: FindingTag[] = ["discipline", "risk", "timing", "execution"];

// Cheap model: one call, JSON out, tolerant of garbage (falls back to "risk").
export async function tagFindings(findings: Finding[]): Promise<Record<string, FindingTag>> {
  if (findings.length === 0) return {};
  const res = await client().chat.completions.create({
    model: MODELS.cheap,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Classify each trading finding into exactly one category: ${TAGS.join(", ")}. ` +
          `discipline = breaking one's own plan; risk = position sizing / exposure; timing = when trades are taken; execution = entries/exits/stops mechanics. ` +
          `Reply with JSON: {"<finding id>": "<category>"}.`,
      },
      { role: "user", content: JSON.stringify(findings.map((f) => ({ id: f.id, title: f.title }))) },
    ],
  });
  const out: Record<string, FindingTag> = {};
  try {
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, string>;
    for (const f of findings) out[f.id] = TAGS.includes(parsed[f.id] as FindingTag) ? (parsed[f.id] as FindingTag) : "risk";
  } catch {
    for (const f of findings) out[f.id] = "risk";
  }
  return out;
}

export type ReportInput = {
  metrics: MetricsPlus;
  findings: Finding[];
  tags: Record<string, FindingTag>;
  news: NewsResult[];
  profile: string;
};

// Strong model: markdown coaching report. Everything numeric comes from `input`; the prompt forbids new numbers.
export async function writeReport(input: ReportInput): Promise<string> {
  const { metrics: m, findings, tags, news } = input;
  const facts = {
    period: m.dateRange,
    totals: {
      trades: m.totalTrades, netPnL: m.totalPnL, winRatePct: m.winRate, profitFactor: m.profitFactor,
      expectancyPerTrade: m.expectancy, avgWin: m.avgWin, avgLoss: m.avgLoss, maxDrawdown: m.maxDrawdown,
      bestTrade: m.bestTrade, worstTrade: m.worstTrade, grossProfit: m.grossProfit, grossLoss: m.grossLoss,
    },
    bySession: m.bySession,
    byExitReason: m.byExitReason,
    bySymbol: m.bySymbol,
    stacked: m.stacked,
    holdMinutes: m.holdAsymmetry,
    revengeTrades: m.revengeTrades,
    worstDay: m.worstDay,
    bestDay: m.bestDay,
    score: m.score,
    findings: findings.map((f) => ({ id: f.id, category: tags[f.id], severity: f.severity, title: f.title, evidence: f.evidence, suggestedAction: f.suggestedAction?.label })),
    newsForWorstDay: news.map((n) => ({ query: n.query, sources: n.sources.map((s) => ({ title: s.title, url: s.url, snippet: s.snippet })) })),
  };

  const res = await client().chat.completions.create({
    model: MODELS.strong,
    temperature: 0.4,
    messages: [
      {
        role: "system",
        content: [
          "You are a blunt, experienced trading coach writing a short audit report for the trader whose history is described in the JSON.",
          "HARD RULES:",
          "- Every number you mention MUST appear verbatim in the JSON. Do not compute, estimate, round differently, or invent any figure.",
          "- Do not give trade signals, predictions, or advice to buy/sell anything. This is a review of past behaviour only.",
          "- Times are broker server time; say so once if you mention sessions or hours.",
          "- If newsForWorstDay has sources, reference them by title with a markdown link when explaining the worst day; if it is empty, say the news lookup found nothing and move on.",
          "FORMAT (markdown, max ~450 words):",
          "## Verdict  (2-3 sentences: the one habit costing the most money, grounded in the highest-severity finding)",
          "## What the numbers say  (4-6 bullets from totals / sessions / exit reasons)",
          "## Your three biggest leaks  (one short paragraph each, ordered by severity, each ending with the concrete suggested action in bold)",
          "## Worst day  (what happened on the worst day, with the news sources if any)",
          "## This week's rule  (ONE specific, checkable behavioural rule for the coming week)",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
}
