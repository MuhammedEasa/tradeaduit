// lib/findings.ts — pattern detectors: (Trade[], MetricsPlus) -> Finding[]
// Each finding carries the exact evidence (numbers computed here) and the trade ids behind it,
// so the dashboard can highlight them and the LLM can only rephrase, never invent.

import type { Finding, Trade } from "./types";
import { hourOf, minutesBetween, revengeTradeIds, sessionOf, stackedGroups, type MetricsPlus, type Session } from "./metrics";

const money = (n: number) => `${n < 0 ? "-" : "+"}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(0)}%`;
const SESSION_LABEL: Record<Session, string> = { asian: "Asian (00-08)", london: "London (08-16)", ny: "New York (16-24)" };

type Detector = (trades: Trade[], m: MetricsPlus) => Finding | null;

// 1. Stops hit far more often than targets.
const slVsTp: Detector = (trades, m) => {
  if (!m.available.exitReason) return null;
  const sl = m.byExitReason.sl.count, tp = m.byExitReason.tp.count;
  if (sl + tp < 20 || tp === 0) return null;
  const ratio = sl / tp;
  if (ratio < 1.3) return null;
  return {
    id: "sl-vs-tp",
    severity: ratio >= 1.8 ? "high" : "medium",
    title: `Stop-loss hit ${ratio.toFixed(1)}x more often than take-profit`,
    evidence: `${sl} exits hit the stop-loss vs ${tp} that hit the take-profit (${m.byExitReason.manual.count} closed manually). SL exits netted ${money(m.byExitReason.sl.pnl)}, TP exits ${money(m.byExitReason.tp.pnl)}. Stops are placed too tight for the volatility, or targets too far.`,
    tradeIds: trades.filter((t) => t.exitReason === "sl" && t.profit < 0).map((t) => t.id),
    suggestedAction: { type: "journal", label: "Journal: review stop placement vs. average range" },
  };
};

// 1b. Manual intervention underperforms the plan (rule-based exits).
const manualExits: Detector = (trades, m) => {
  if (!m.available.exitReason) return null;
  const man = m.byExitReason.manual;
  const mech = trades.filter((t) => t.exitReason !== "manual");
  if (man.count < 10 || mech.length < 10) return null;
  const mechPnl = mech.reduce((s, t) => s + t.profit, 0);
  const mechWr = (mech.filter((t) => t.profit > 0).length / mech.length) * 100;
  if (man.pnl >= 0 && man.winRate >= mechWr * 0.7) return null;
  return {
    id: "manual-exits",
    severity: man.pnl < 0 && man.winRate < mechWr * 0.5 ? "high" : "medium",
    title: `Manual closes win only ${man.winRate.toFixed(0)}% of the time: ${money(man.pnl)}`,
    evidence: `${man.count} trades were closed by hand (no SL/TP hit) and netted ${money(man.pnl)} with a ${man.winRate.toFixed(0)}% win rate. The ${mech.length} trades left to run to their stop or target netted ${money(mechPnl)} with a ${mechWr.toFixed(0)}% win rate. Overriding the plan is the single most expensive habit in this history.`,
    tradeIds: trades.filter((t) => t.exitReason === "manual" && t.profit < 0).map((t) => t.id),
    suggestedAction: { type: "journal", label: "Journal: log the reason before every manual close" },
  };
};

// 2. All the risk in one instrument.
const concentration: Detector = (trades, m) => {
  const [top] = Object.entries(m.bySymbol).sort((a, b) => b[1].count - a[1].count);
  if (!top) return null;
  const share = (top[1].count / m.totalTrades) * 100;
  if (share < 70) return null;
  return {
    id: "concentration",
    severity: share >= 90 ? "medium" : "low",
    title: `${pct(share)} of trades are in ${top[0]}`,
    evidence: `${top[1].count} of ${m.totalTrades} trades are ${top[0]} (${money(top[1].pnl)}, ${top[1].winRate}% win rate). Every result depends on one market's behaviour; there is no diversification of edge.`,
    tradeIds: [],
  };
};

// 3. Several positions opened in the same second = one idea, multiplied.
const stacked: Detector = (trades, m) => {
  const groups = stackedGroups(trades);
  if (groups.length === 0) return null;
  const share = (m.stacked.trades / m.totalTrades) * 100;
  if (share < 10) return null;
  const biggest = [...groups].sort((a, b) => b.length - a.length)[0];
  const losingGroups = groups.filter((g) => g.reduce((s, t) => s + t.profit, 0) < 0);
  return {
    id: "stacked-entries",
    severity: share >= 30 ? "high" : "medium",
    title: `${pct(share)} of trades were stacked: opened in the same second`,
    evidence: `${m.stacked.trades} trades across ${groups.length} same-second clusters (largest: ${biggest.length} positions at ${biggest[0].openTime.replace("T", " ")}). Stacked trades netted ${money(m.stacked.pnl)}; ${losingGroups.length} of ${groups.length} clusters lost money. One adverse move hits every position at once, so real risk per idea is ${biggest.length}x the apparent lot size.`,
    tradeIds: groups.flat().map((t) => t.id),
    suggestedAction: { type: "alert", label: "Alert: warn when a second position opens within 60s of the first" },
  };
};

// 4. Worst session.
const worstSession: Detector = (trades, m) => {
  const entries = (Object.keys(m.bySession) as Session[]).map((s) => [s, m.bySession[s]] as const).filter(([, v]) => v.count >= 10);
  if (entries.length < 2) return null;
  const [worst, ws] = entries.sort((a, b) => a[1].pnl - b[1].pnl)[0];
  const [best, bs] = entries.sort((a, b) => b[1].pnl - a[1].pnl)[0];
  if (ws.pnl >= 0 && ws.pnl > bs.pnl * 0.5) return null;
  return {
    id: "worst-session",
    severity: ws.pnl < 0 ? "high" : "medium",
    title: `${SESSION_LABEL[worst]} session is the weakest: ${money(ws.pnl)} over ${ws.count} trades`,
    evidence: `${SESSION_LABEL[worst]}: ${ws.count} trades, ${money(ws.pnl)}, ${ws.winRate}% win rate. Compare ${SESSION_LABEL[best]}: ${bs.count} trades, ${money(bs.pnl)}, ${bs.winRate}% win rate. Times are broker server time.`,
    tradeIds: trades.filter((t) => sessionOf(t.openTime) === worst && t.profit < 0).map((t) => t.id),
    suggestedAction: { type: "alert", label: `Alert: remind me before trading the ${worst.toUpperCase()} session` },
  };
};

// 5. Worst hour of day.
const worstHour: Detector = (trades, m) => {
  const hours = Object.entries(m.byHour).filter(([, v]) => v.count >= 10).sort((a, b) => a[1].pnl - b[1].pnl);
  if (hours.length === 0 || hours[0][1].pnl >= 0) return null;
  const [h, v] = hours[0];
  return {
    id: "worst-hour",
    severity: "medium",
    title: `Trades opened at ${h}:00 lose consistently: ${money(v.pnl)}`,
    evidence: `${v.count} trades opened during the ${h}:00 hour returned ${money(v.pnl)} with a ${v.winRate}% win rate, the worst hour in the history (broker time).`,
    tradeIds: trades.filter((t) => String(hourOf(t.openTime)).padStart(2, "0") === h && t.profit < 0).map((t) => t.id),
  };
};

// 6. Big losses taken without a stop-loss.
const noStop: Detector = (trades, m) => {
  if (!m.available.sl) return null;   // no S/L column in this export: unknown, not "none"
  const { withoutSL, bigLossesWithoutSL } = m.slUsage;
  if (withoutSL === 0) return null;
  const share = (withoutSL / m.totalTrades) * 100;
  const noSl = trades.filter((t) => t.sl === 0);
  const noSlPnl = noSl.reduce((s, t) => s + t.profit, 0);
  return {
    id: "no-stop-loss",
    severity: bigLossesWithoutSL > 0 ? "high" : share > 20 ? "medium" : "low",
    title: `${withoutSL} trades (${pct(share)}) had no stop-loss`,
    evidence: `${withoutSL} trades were opened without a stop-loss and netted ${money(noSlPnl)}; ${bigLossesWithoutSL} of them lost more than twice the average loss (${money(m.avgLoss)}). Uncapped downside on those trades.`,
    tradeIds: noSl.filter((t) => t.profit < 0).map((t) => t.id),
    suggestedAction: { type: "alert", label: "Alert: flag any open position without a stop-loss" },
  };
};

// 7. Revenge trading: re-entering within minutes of a loss at the same or bigger size.
const revenge: Detector = (trades, m) => {
  const ids = revengeTradeIds(trades);
  if (ids.length < 5) return null;
  const set = new Set(ids);
  const rt = trades.filter((t) => set.has(t.id));
  const pnl = rt.reduce((s, t) => s + t.profit, 0);
  const wr = (rt.filter((t) => t.profit > 0).length / rt.length) * 100;
  const share = (ids.length / m.totalTrades) * 100;
  return {
    id: "revenge-trading",
    severity: pnl < 0 && share >= 10 ? "high" : "medium",
    title: `${ids.length} revenge re-entries within 5 minutes of a loss`,
    evidence: `${ids.length} trades (${pct(share)}) were opened within 5 minutes of a losing close in the same symbol at equal or larger size. They returned ${money(pnl)} with a ${wr.toFixed(0)}% win rate vs ${m.winRate}% overall.`,
    tradeIds: ids,
    suggestedAction: { type: "alert", label: "Alert: 15-minute cool-down after a losing trade" },
  };
};

// 8. Losers held longer than winners.
const holdAsymmetry: Detector = (trades, m) => {
  const { avgWinMins, avgLossMins } = m.holdAsymmetry;
  if (avgWinMins === 0 || avgLossMins / avgWinMins < 1.5) return null;
  const longest = [...trades].filter((t) => t.profit < 0).sort((a, b) => minutesBetween(b.openTime, b.closeTime) - minutesBetween(a.openTime, a.closeTime)).slice(0, 10);
  return {
    id: "hold-asymmetry",
    severity: avgLossMins / avgWinMins >= 3 ? "high" : "medium",
    title: `Losers are held ${(avgLossMins / avgWinMins).toFixed(1)}x longer than winners`,
    evidence: `Average winning trade lasts ${fmtMins(avgWinMins)}; average losing trade lasts ${fmtMins(avgLossMins)}. Profits are cut short while losses are given room, the classic disposition effect.`,
    tradeIds: longest.map((t) => t.id),
    suggestedAction: { type: "journal", label: "Journal: note why each loser was held past its plan" },
  };
};

// 9. The single worst day (drives the Exa news lookup).
const worstDay: Detector = (trades, m) => {
  if (!m.worstDay || m.worstDay.pnl >= 0) return null;
  const { day, pnl, count } = m.worstDay;
  const dayTrades = trades.filter((t) => t.closeTime.startsWith(day));
  const syms = [...new Set(dayTrades.map((t) => t.symbol))].join(", ");
  const share = m.grossLoss > 0 ? (Math.abs(pnl) / m.grossLoss) * 100 : 0;
  return {
    id: "worst-day",
    severity: share >= 10 ? "high" : "medium",
    title: `Worst day: ${day}, ${money(pnl)} across ${count} trades`,
    evidence: `${count} trades in ${syms} closed on ${day} for ${money(pnl)}, which is ${pct(share)} of all losses in the history. Largest single loss that day: ${money(Math.min(...dayTrades.map((t) => t.profit)))}.`,
    tradeIds: dayTrades.filter((t) => t.profit < 0).map((t) => t.id),
    suggestedAction: { type: "journal", label: `Journal: what happened on ${day}?` },
  };
};

// 10. Drawdown relative to what was ever made.
const drawdown: Detector = (_trades, m) => {
  const peak = Math.max(m.totalPnL, m.maxDrawdown); // conservative denominator when equity never peaked far above current
  if (m.maxDrawdown === 0 || peak === 0) return null;
  const ratio = m.maxDrawdown / peak;
  if (ratio < 0.3) return null;
  return {
    id: "drawdown",
    severity: ratio >= 0.6 ? "high" : "medium",
    title: `Max drawdown of ${money(-m.maxDrawdown)} wiped ${pct(ratio * 100)} of peak profit`,
    evidence: `The realised P&L fell ${money(-m.maxDrawdown)} from its peak at one point, against a total net result of ${money(m.totalPnL)}. Gains are being given back in clusters of losses.`,
    tradeIds: [],
  };
};

function fmtMins(mins: number): string {
  if (mins < 60) return `${mins.toFixed(0)} min`;
  const h = Math.floor(mins / 60), mm = Math.round(mins % 60);
  return `${h}h ${mm}m`;
}

const DETECTORS: Detector[] = [manualExits, slVsTp, stacked, worstSession, worstDay, revenge, holdAsymmetry, noStop, worstHour, concentration, drawdown];
const RANK = { high: 0, medium: 1, low: 2 } as const;

export function detectFindings(trades: Trade[], m: MetricsPlus): Finding[] {
  const out: Finding[] = [];
  for (const d of DETECTORS) {
    const f = d(trades, m);
    if (f) out.push(f);
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
