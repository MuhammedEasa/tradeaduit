// lib/parse.ts — CSV NORMALIZER: any broker export -> canonical Trade[]
//
// Every platform exports a different shape (MQL5 signal history, MT5 terminal report, ...),
// so this is a normalizer, not a one-off parser:
//   1. sniff the file (strip BOM, detect delimiter)
//   2. match a header PROFILE (known layout) -> column indexes; else fuzzy generic fallback
//   3. normalize every value (numbers with " " or "," thousands separators, several date formats,
//      buy/sell casing, "[sl]"/"[tp]" exit comments)
//   4. drop non-trade rows (pending orders, cancelled, balance/deposit rows, rows with no profit)
//   5. return { trades, profile, dropped, warnings } so the UI can say what it did.

import Papa from "papaparse";
import type { ExitReason, Trade } from "./types";

export type ParseResult = {
  trades: Trade[];
  profile: string;      // which header profile matched ("mql5-signals" | "generic")
  dropped: number;      // rows skipped (pending/cancelled/balance/no profit/unparseable)
  warnings: string[];
};

// Column indexes into a raw row. A profile turns the header line into one of these.
type ColumnMap = {
  openTime: number; type: number; volume: number; symbol: number;
  openPrice: number; closePrice: number; closeTime: number; profit: number;
  sl?: number; tp?: number; commission?: number; swap?: number; comment?: number;
};

type Profile = { name: string; match: (headers: string[]) => ColumnMap | null };

// ---------- 1. sniff ----------

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function sniffDelimiter(headerLine: string): string {
  const candidates = [";", ",", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

// ---------- 2. profiles ----------

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

// MQL5 signal-history export. Header names are DUPLICATED (Time, Price appear twice) so we map by POSITION.
//   Time;Type;Volume;Symbol;Price;S/L;T/P;Time;Price;Commission;Swap;Profit;Comment
const mql5Signals: Profile = {
  name: "mql5-signals",
  match(headers) {
    const h = headers.map(norm);
    const expected = ["time", "type", "volume", "symbol", "price", "sl", "tp", "time", "price", "commission", "swap", "profit", "comment"];
    if (h.length < expected.length) return null;
    if (!expected.every((e, i) => h[i] === e)) return null;
    return { openTime: 0, type: 1, volume: 2, symbol: 3, openPrice: 4, sl: 5, tp: 6, closeTime: 7, closePrice: 8, commission: 9, swap: 10, profit: 11, comment: 12 };
  },
};

// Generic fallback: fuzzy-match header names. Handles "Open Time"/"Close Time", "Lots"/"Size",
// "Instrument", "Side"/"Direction", "PnL"/"Net Profit", etc. If a name appears twice (e.g. two "Price"
// columns) the first is treated as open and the second as close.
const generic: Profile = {
  name: "generic",
  match(headers) {
    const h = headers.map(norm);
    const find = (...alts: string[]) => h.findIndex((x) => alts.includes(x));
    const findAll = (...alts: string[]) => h.map((x, i) => (alts.includes(x) ? i : -1)).filter((i) => i >= 0);

    const symbol = find("symbol", "instrument", "ticker", "pair", "asset");
    const type = find("type", "side", "direction", "action");
    const volume = find("volume", "lots", "size", "quantity", "qty", "lot");
    const profit = find("profit", "pnl", "pl", "netprofit", "netpnl", "realizedpnl", "result");

    let openTime = find("opentime", "entrytime", "openedat", "opened", "entry");
    let closeTime = find("closetime", "exittime", "closedat", "closed", "exit");
    const times = findAll("time", "date", "datetime", "timestamp");
    if (openTime < 0 && times.length > 0) openTime = times[0];
    if (closeTime < 0 && times.length > 1) closeTime = times[1];

    let openPrice = find("openprice", "entryprice", "open");
    let closePrice = find("closeprice", "exitprice", "close");
    const prices = findAll("price");
    if (openPrice < 0 && prices.length > 0) openPrice = prices[0];
    if (closePrice < 0 && prices.length > 1) closePrice = prices[1];

    const required = { symbol, type, volume, profit, openTime, closeTime, openPrice, closePrice };
    if (Object.values(required).some((i) => i < 0)) return null;

    const opt = (i: number) => (i >= 0 ? i : undefined);
    return {
      ...required,
      sl: opt(find("sl", "stoploss", "stop")),
      tp: opt(find("tp", "takeprofit", "take", "target")),
      commission: opt(find("commission", "fee", "fees")),
      swap: opt(find("swap", "rollover", "financing")),
      comment: opt(find("comment", "comments", "note", "reason")),
    };
  },
};

const PROFILES: Profile[] = [mql5Signals, generic];

// ---------- 3. value normalizers ----------

// "4 343.33" -> 4343.33 ; "1,234.56" -> 1234.56 ; "" -> 0
export function toNumber(raw: string | undefined): number {
  if (raw == null) return 0;
  const cleaned = raw.replace(/[\s,]/g, "");
  if (cleaned === "") return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Accepts "YYYY.MM.DD HH:MM:SS", "YYYY-MM-DD HH:MM:SS", "YYYY/MM/DD HH:MM", ISO. Returns "YYYY-MM-DDTHH:mm:ss" or null.
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, y, mo, d, hh = "0", mm = "0", ss = "0"] = m;
    const pad = (v: string) => v.padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 19);
  return null;
}

// Only executed market trades count. "Buy Stop"/"Sell Limit" (pending), "Balance", "Deposit" etc. -> null.
export function normalizeType(raw: string | undefined): "buy" | "sell" | null {
  const t = (raw ?? "").trim().toLowerCase();
  if (t === "buy" || t === "long") return "buy";
  if (t === "sell" || t === "short") return "sell";
  return null;
}

export function exitReasonFromComment(comment: string | undefined): ExitReason {
  const c = (comment ?? "").toLowerCase();
  if (c.includes("[sl]") || c.includes("stop loss") || c.includes("stoploss")) return "sl";
  if (c.includes("[tp]") || c.includes("take profit") || c.includes("takeprofit")) return "tp";
  return "manual";
}

// ---------- 4. main ----------

export function parseTrades(csvText: string): ParseResult {
  const warnings: string[] = [];
  const text = stripBom(csvText);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = sniffDelimiter(firstLine);

  const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length < 2) {
    return { trades: [], profile: "none", dropped: 0, warnings: ["File has no data rows"] };
  }

  const headers = rows[0];
  let profile: Profile | null = null;
  let cols: ColumnMap | null = null;
  for (const p of PROFILES) {
    cols = p.match(headers);
    if (cols) { profile = p; break; }
  }
  if (!profile || !cols) {
    return { trades: [], profile: "none", dropped: rows.length - 1, warnings: [`Unrecognised header: ${headers.join(delimiter)}`] };
  }

  const trades: Omit<Trade, "id">[] = [];
  let dropped = 0;
  let badDates = 0;

  for (const cells of rows.slice(1)) {
    const get = (i: number | undefined) => (i == null ? undefined : cells[i]);

    const type = normalizeType(get(cols.type));
    if (!type) { dropped++; continue; }                       // pending / cancelled / balance rows

    const profitRaw = (get(cols.profit) ?? "").trim();
    if (profitRaw === "") { dropped++; continue; }            // still open / not a closed trade

    const openTime = parseDate(get(cols.openTime));
    const closeTime = parseDate(get(cols.closeTime));
    if (!openTime || !closeTime) { dropped++; badDates++; continue; }

    trades.push({
      openTime,
      closeTime,
      symbol: (get(cols.symbol) ?? "").trim().toUpperCase(),
      type,
      volume: toNumber(get(cols.volume)),
      openPrice: toNumber(get(cols.openPrice)),
      closePrice: toNumber(get(cols.closePrice)),
      sl: toNumber(get(cols.sl)),
      tp: toNumber(get(cols.tp)),
      commission: toNumber(get(cols.commission)),
      swap: toNumber(get(cols.swap)),
      profit: toNumber(profitRaw),
      exitReason: exitReasonFromComment(get(cols.comment)),
    });
  }

  if (badDates > 0) warnings.push(`${badDates} rows skipped: unparseable dates`);
  if (cols.comment == null) warnings.push("No comment column: exit reasons unknown (all marked manual)");
  if (cols.sl == null) warnings.push("No S/L column: stop-loss usage cannot be assessed");

  // Stable ids in chronological order (exports are usually newest-first).
  trades.sort((a, b) => (a.openTime < b.openTime ? -1 : a.openTime > b.openTime ? 1 : 0));
  const withIds: Trade[] = trades.map((t, i) => ({ id: `t${i + 1}`, ...t }));

  return { trades: withIds, profile: profile.name, dropped, warnings };
}
