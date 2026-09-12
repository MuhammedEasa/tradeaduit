// THE CONTRACT — shared shapes every module (parse, metrics, findings, news, llm, job, UI) builds against.
// Code computes every number here; the LLM only ever turns them into words.

export type ExitReason = "sl" | "tp" | "manual" | "unknown"; // unknown = the export has no comment/reason column

export type Trade = {
  id: string;            // stable per file: "t1", "t2", ... in chronological order of openTime
  openTime: string;      // ISO-like "YYYY-MM-DDTHH:mm:ss" in broker server time (no timezone)
  closeTime: string;
  symbol: string;
  type: "buy" | "sell";
  volume: number;
  openPrice: number;
  closePrice: number;
  sl: number;            // 0 = no stop-loss set
  tp: number;            // 0 = no take-profit set
  commission: number;
  swap: number;
  profit: number;
  exitReason: ExitReason; // from the broker comment: "[sl]" | "[tp]" | "" (manual); "unknown" if the export has no such column
};

export type SessionStat = { pnl: number; count: number; winRate: number };

export type Metrics = {
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  bestTrade: number;
  worstTrade: number;
  bySession: Record<"asian" | "london" | "ny", SessionStat>;
  bySymbol: Record<string, SessionStat>;
  byDay: Record<string, { pnl: number; count: number }>;
  slUsage: { withSL: number; withoutSL: number; bigLossesWithoutSL: number };
  revengeTrades: number;                                      // rapid bigger re-entry after a loss
  holdAsymmetry: { avgWinMins: number; avgLossMins: number }; // losers held longer?
};

export type Finding = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  tradeIds: string[];
  suggestedAction?: { type: "journal" | "alert"; label: string };
};

export type AuditStep = {
  name: string;
  status: "running" | "done" | "error";
  detail?: string;
  ts: string;
};

export type AuditResult = {
  metrics: Metrics;
  findings: Finding[];
  news: { query: string; sources: { title: string; url: string; snippet: string }[] }[];
  report: string;
  steps: AuditStep[];
};
