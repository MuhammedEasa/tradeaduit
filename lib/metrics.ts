// lib/metrics.ts — pure functions: Trade[] -> Metrics. NO LLM anywhere in here.
// Every number the report ever mentions is computed in this file (or findings.ts) so nothing is hallucinated.

import type { Metrics, SessionStat, Trade } from "./types";

export type Session = "asian" | "london" | "ny";

// Broker server time (MT5 brokers are usually UTC+2/+3). Asian 00-08, London 08-16, NY 16-24.
export function sessionOf(isoTime: string): Session {
  const h = hourOf(isoTime);
  if (h < 8) return "asian";
  if (h < 16) return "london";
  return "ny";
}

export function hourOf(isoTime: string): number {
  return parseInt(isoTime.slice(11, 13), 10);
}

export function dayOf(isoTime: string): string {
  return isoTime.slice(0, 10);
}

export function minutesBetween(a: string, b: string): number {
  return (Date.parse(b + "Z") - Date.parse(a + "Z")) / 60_000;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

export function statOf(trades: Trade[]): SessionStat {
  const wins = trades.filter((t) => t.profit > 0).length;
  return {
    pnl: round2(sum(trades.map((t) => t.profit))),
    count: trades.length,
    winRate: trades.length ? round2((wins / trades.length) * 100) : 0,
  };
}

function groupBy<K extends string>(trades: Trade[], key: (t: Trade) => K): Record<K, Trade[]> {
  const out = {} as Record<K, Trade[]>;
  for (const t of trades) (out[key(t)] ??= []).push(t);
  return out;
}

// Trades opened at the exact same second = one decision split into N positions = correlated risk.
export function stackedGroups(trades: Trade[]): Trade[][] {
  return Object.values(groupBy(trades, (t) => t.openTime)).filter((g) => g.length > 1);
}

// Revenge trade: a new entry in the same symbol within `windowMins` after a losing close, at equal or bigger size.
export function revengeTradeIds(trades: Trade[], windowMins = 5): string[] {
  const byClose = [...trades].sort((a, b) => a.closeTime.localeCompare(b.closeTime));
  const byOpen = [...trades].sort((a, b) => a.openTime.localeCompare(b.openTime));
  const ids = new Set<string>();
  for (const loss of byClose) {
    if (loss.profit >= 0) continue;
    for (const next of byOpen) {
      if (next.openTime <= loss.closeTime) continue;
      if (minutesBetween(loss.closeTime, next.openTime) > windowMins) break;
      if (next.symbol === loss.symbol && next.volume >= loss.volume) ids.add(next.id);
    }
  }
  return [...ids];
}

// Peak-to-trough drop of the running realised P&L, in account currency.
export function maxDrawdown(trades: Trade[]): { drawdown: number; peak: number } {
  const byClose = [...trades].sort((a, b) => a.closeTime.localeCompare(b.closeTime));
  let equity = 0, peak = 0, dd = 0;
  for (const t of byClose) {
    equity += t.profit;
    if (equity > peak) peak = equity;
    if (peak - equity > dd) dd = peak - equity;
  }
  return { drawdown: round2(dd), peak: round2(peak) };
}

export type Grade = "A" | "B" | "C" | "D" | "F";
export type Score = {
  total: number; // 0-100
  grades: { profitability: Grade; risk: Grade; drawdown: Grade; consistency: Grade };
};

const gradeOf = (pts: number): Grade => (pts >= 85 ? "A" : pts >= 70 ? "B" : pts >= 55 ? "C" : pts >= 40 ? "D" : "F");

// Deterministic score card. Each pillar is 0-100 from computed metrics; total is the average.
export function scoreOf(m: Metrics, trades: Trade[]): Score {
  const profitability = Math.max(0, Math.min(100, (m.profitFactor - 0.5) * 50));       // PF 0.5 -> 0, 1.5 -> 50, 2.5 -> 100
  const slShare = m.totalTrades ? m.slUsage.withSL / m.totalTrades : 0;
  const stacked = stackedGroups(trades).flat().length / Math.max(1, m.totalTrades);
  const risk = Math.max(0, Math.min(100, slShare * 70 + (1 - stacked) * 30));          // SL discipline + no stacking
  const { peak } = maxDrawdown(trades);
  const ddPct = peak > 0 ? m.maxDrawdown / peak : 1;
  const drawdown = Math.max(0, Math.min(100, 100 - ddPct * 150));                      // 0% -> 100, 33% -> 50, 66% -> 0
  const days = Object.values(m.byDay);
  const greenDays = days.filter((d) => d.pnl > 0).length / Math.max(1, days.length);
  const consistency = Math.max(0, Math.min(100, greenDays * 130));                     // 77% green days -> 100
  const pillars = { profitability, risk, drawdown, consistency };
  return {
    total: Math.round(avg(Object.values(pillars))),
    grades: {
      profitability: gradeOf(profitability),
      risk: gradeOf(risk),
      drawdown: gradeOf(drawdown),
      consistency: gradeOf(consistency),
    },
  };
}

// Extra breakdowns beyond the base contract; additive so nothing downstream breaks.
export type MetricsPlus = Metrics & {
  byHour: Record<string, SessionStat>;             // "00".."23" by open hour (broker time)
  byExitReason: Record<"sl" | "tp" | "manual", SessionStat>;
  stacked: { groups: number; trades: number; pnl: number };
  grossProfit: number;
  grossLoss: number;
  totalCommission: number;
  totalSwap: number;
  worstDay: { day: string; pnl: number; count: number } | null;
  bestDay: { day: string; pnl: number; count: number } | null;
  dateRange: { from: string; to: string };
  score: Score;
};

export function computeMetrics(trades: Trade[]): MetricsPlus {
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const grossProfit = sum(wins.map((t) => t.profit));
  const grossLoss = Math.abs(sum(losses.map((t) => t.profit)));
  const totalPnL = sum(trades.map((t) => t.profit));

  const bySessionRaw = groupBy(trades, (t) => sessionOf(t.openTime));
  const bySession = {
    asian: statOf(bySessionRaw.asian ?? []),
    london: statOf(bySessionRaw.london ?? []),
    ny: statOf(bySessionRaw.ny ?? []),
  };

  const bySymbol: Record<string, SessionStat> = {};
  for (const [sym, ts] of Object.entries(groupBy(trades, (t) => t.symbol))) bySymbol[sym] = statOf(ts);

  const byDay: Record<string, { pnl: number; count: number }> = {};
  for (const [day, ts] of Object.entries(groupBy(trades, (t) => dayOf(t.closeTime)))) {
    byDay[day] = { pnl: round2(sum(ts.map((t) => t.profit))), count: ts.length };
  }
  const daysSorted = Object.entries(byDay).sort((a, b) => a[1].pnl - b[1].pnl);
  const worstDay = daysSorted.length ? { day: daysSorted[0][0], ...daysSorted[0][1] } : null;
  const bestDay = daysSorted.length ? { day: daysSorted[daysSorted.length - 1][0], ...daysSorted[daysSorted.length - 1][1] } : null;

  const byHour: Record<string, SessionStat> = {};
  for (const [h, ts] of Object.entries(groupBy(trades, (t) => String(hourOf(t.openTime)).padStart(2, "0")))) byHour[h] = statOf(ts);

  const byExitRaw = groupBy(trades, (t) => t.exitReason);
  const byExitReason = {
    sl: statOf(byExitRaw.sl ?? []),
    tp: statOf(byExitRaw.tp ?? []),
    manual: statOf(byExitRaw.manual ?? []),
  };

  const avgLoss = avg(losses.map((t) => t.profit));
  const withoutSL = trades.filter((t) => t.sl === 0);
  const bigLossesWithoutSL = withoutSL.filter((t) => t.profit < avgLoss * 2).length;

  const groups = stackedGroups(trades);
  const stackedTrades = groups.flat();

  const sorted = [...trades].sort((a, b) => a.openTime.localeCompare(b.openTime));

  const base: Metrics = {
    totalTrades: trades.length,
    winRate: trades.length ? round2((wins.length / trades.length) * 100) : 0,
    totalPnL: round2(totalPnL),
    profitFactor: grossLoss > 0 ? round2(grossProfit / grossLoss) : grossProfit > 0 ? Infinity : 0,
    expectancy: trades.length ? round2(totalPnL / trades.length) : 0,
    avgWin: round2(avg(wins.map((t) => t.profit))),
    avgLoss: round2(avgLoss),
    maxDrawdown: maxDrawdown(trades).drawdown,
    bestTrade: trades.length ? Math.max(...trades.map((t) => t.profit)) : 0,
    worstTrade: trades.length ? Math.min(...trades.map((t) => t.profit)) : 0,
    bySession,
    bySymbol,
    byDay,
    slUsage: { withSL: trades.length - withoutSL.length, withoutSL: withoutSL.length, bigLossesWithoutSL },
    revengeTrades: revengeTradeIds(trades).length,
    holdAsymmetry: {
      avgWinMins: round2(avg(wins.map((t) => minutesBetween(t.openTime, t.closeTime)))),
      avgLossMins: round2(avg(losses.map((t) => minutesBetween(t.openTime, t.closeTime)))),
    },
  };

  const plus: Omit<MetricsPlus, "score"> = {
    ...base,
    byHour,
    byExitReason,
    stacked: { groups: groups.length, trades: stackedTrades.length, pnl: round2(sum(stackedTrades.map((t) => t.profit))) },
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    totalCommission: round2(sum(trades.map((t) => t.commission))),
    totalSwap: round2(sum(trades.map((t) => t.swap))),
    worstDay,
    bestDay,
    dateRange: { from: sorted[0]?.openTime ?? "", to: sorted[sorted.length - 1]?.closeTime ?? "" },
  };

  return { ...plus, score: scoreOf(base, trades) };
}
