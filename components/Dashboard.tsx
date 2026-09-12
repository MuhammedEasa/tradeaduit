"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AuditView } from "@/lib/runner";
import type { ActionEntry } from "@/lib/store";
import type { Finding, Trade } from "@/lib/types";
import { EquityCurve } from "./EquityCurve";
import { CountUp } from "./CountUp";
import { Markdown } from "./Markdown";
import { Nav } from "./Nav";
import { Ticker } from "./Ticker";
import { StageTracker, Skeleton, ScoreRing, Bars, FindingCard, splitReport, money } from "./ui";

type Data = AuditView & { actions: ActionEntry[] };


function sessionOf(iso: string) { const h = parseInt(iso.slice(11, 13), 10); return h < 8 ? "asian" : h < 16 ? "london" : "ny"; }

export function Dashboard({ id, print = false }: { id: string; print?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ session?: string; exitReason?: string; onlyHighlighted?: boolean }>({});
  const markedUp = useRef(false);
  const failures = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/audit/${id}`, { cache: "no-store" });
        if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
        const d = (await res.json()) as Data;
        if (stop) return;
        failures.current = 0;
        setErr(null);
        setData(d);
        // The agent marks up the dashboard once: apply its filter and select its top finding.
        if (d.status === "done" && d.result && !markedUp.current) {
          markedUp.current = true;
          if (d.result.appliedFilter) setFilter({ ...d.result.appliedFilter, onlyHighlighted: true });
          if (d.result.findings[0]) setSelected(d.result.findings[0].id);
        }
        if (!stop && d.status !== "done" && d.status !== "error") setTimeout(tick, 1200);
      } catch (e) {
        if (stop) return;
        failures.current += 1;
        if (failures.current >= 5) setErr((e as Error).message);   // transient: keep polling quietly first
        setTimeout(tick, 1500);
      }
    };
    tick();
    return () => { stop = true; };
  }, [id]);

  const r = data?.result;
  const trades = data?.trades ?? [];
  const highlighted = useMemo(() => new Set(r?.highlightedTradeIds ?? []), [r]);
  const selectedIds = useMemo(() => new Set(r?.findings.find((f) => f.id === selected)?.tradeIds ?? []), [r, selected]);

  const visible = useMemo(() => {
    let t = trades;
    if (filter.session) t = t.filter((x) => sessionOf(x.openTime) === filter.session);
    if (filter.exitReason) t = t.filter((x) => x.exitReason === filter.exitReason);
    if (filter.onlyHighlighted && selected) t = t.filter((x) => selectedIds.has(x.id));
    return [...t].sort((a, b) => b.openTime.localeCompare(a.openTime));
  }, [trades, filter, selected, selectedIds]);

  async function decide(f: Finding, decision: "approved" | "rejected") {
    if (!f.suggestedAction || !data) return;
    await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditId: data.id, findingId: f.id, type: f.suggestedAction.type, label: f.suggestedAction.label, decision }) });
    const res = await fetch(`/api/audit/${id}`, { cache: "no-store" });
    setData(await res.json());
  }
  const decisionFor = (f: Finding) => data?.actions.find((a) => a.findingId === f.id);

  if (err && !data) return <main className="p-10 text-bad">Could not load audit: {err}</main>;
  if (!data) return (
    <main className="min-h-screen px-6"><Nav /><div className="mx-auto max-w-6xl space-y-4"><Skeleton h="h-28" /><Skeleton h="h-64" /></div></main>
  );

  const m = r?.metrics;

  return (
    <main className="min-h-screen px-6 pb-20">
      <Nav right={<>
        <span className="text-xs text-ink-3">{data.mode === "trigger" ? "Trigger.dev job" : "inline job"}{data.runId ? ` · ${data.runId.slice(0, 12)}` : ""}</span>
        {r && !print && <Link className="btn btn-ghost" href={`/report/${id}`}>Report</Link>}
        {r && print && <button className="btn" onClick={() => window.print()}>Export PDF</button>}
        {!print && <Link className="btn" href="/">New audit</Link>}
      </>} />
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 pb-4">
        <span className="text-sm text-ink-2">{data.fileName}</span>
        {data.sourceName && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink-2">auto-synced · {data.sourceName}</span>}
        <span className={`rounded-full px-2 py-0.5 text-xs ${data.status === "done" ? "bg-muted text-good" : data.status === "error" ? "bg-muted text-bad" : "bg-muted text-accent pulse"}`}>
          {data.status === "done" ? "audit complete" : data.status === "error" ? "audit failed" : "agent working"}
        </span>
        {print && <span className="ml-auto text-xs text-ink-3">TradeAudit report · {new Date(data.createdAt).toLocaleString()}</span>}
      </div>

      <div className="mx-auto max-w-6xl space-y-6">
        {/* Live headlines for the instruments in this history */}
        {m && !print && <Ticker symbols={Object.entries(m.bySymbol).sort((a, b) => b[1].count - a[1].count).slice(0, 4).map(([s]) => s)} />}

        {/* Where the agent is, at a glance */}
        {!print && <StageTracker steps={data.steps} status={data.status} startedAt={data.createdAt} />}

        {/* Activity feed: live while working, collapsed to a toggle once done */}
        {!print && data.status === "done" && !showLog && (
          <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setShowLog(true)}>Show the agent&apos;s full log ({data.steps.length} steps) ↓</button>
        )}
        {!print && (data.status !== "done" || showLog) && (
          <section className="mac fade-up d1">
            <div className="mac-bar">
              <span className="dot" style={{ background: "#ff5f57" }} /><span className="dot" style={{ background: "#febc2e" }} /><span className="dot" style={{ background: "#28c840" }} />
              <span className="ml-3 text-xs text-neutral-400">agent — activity feed</span>
            </div>
            <ol className="num space-y-1.5 p-4 text-[13px] leading-relaxed">
              {data.steps.length === 0 && <li className="text-neutral-500 pulse">▸ queued, waiting for a worker…</li>}
              {data.steps.map((s, i) => (
                <li key={i} className="flex gap-3 slide-in">
                  <span className="shrink-0 text-neutral-500">{s.ts.slice(11, 19)}</span>
                  <span className={`shrink-0 w-14 ${s.status === "done" ? "text-[#28c840]" : s.status === "error" ? "text-[#ff5f57]" : "text-[#febc2e] pulse"}`}>{s.status}</span>
                  <span><span className="text-neutral-100">{s.name}</span>{s.detail && <span className="text-neutral-400"> — {s.detail}</span>}</span>
                </li>
              ))}
              {data.status === "error" && <li className="text-[#ff5f57]">✗ {data.error}</li>}
            </ol>
          </section>
        )}

        {!m && data.status !== "error" && (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} h="h-20" className={`fade-up d${i}`} />)}</div>
        )}

        {m && r && (
          <>
            {/* Stat tiles */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {([
                ["Net P&L", <CountUp key="pnl" value={m.totalPnL} format={money} />, m.totalPnL >= 0 ? "text-good" : "text-bad"],
                ["Trades", <CountUp key="n" value={m.totalTrades} format={(n) => Math.round(n).toLocaleString()} />, ""],
                ["Win rate", <CountUp key="wr" value={m.winRate} format={(n) => `${n.toFixed(2)}%`} />, ""],
                ["Profit factor", <CountUp key="pf" value={m.profitFactor} format={(n) => n.toFixed(2)} />, ""],
                ["Max drawdown", <CountUp key="dd" value={-m.maxDrawdown} format={money} />, "text-bad"],
                ["Expectancy / trade", <CountUp key="ex" value={m.expectancy} format={money} />, m.expectancy >= 0 ? "text-good" : "text-bad"],
              ] as [string, React.ReactNode, string][]).map(([l, v, c], i) => (
                <div key={String(l)} className={`card px-4 py-3 fade-up d${i + 1}`}><p className="label">{l}</p><p className={`num mt-1 text-xl font-semibold ${c}`}>{v}</p></div>
              ))}
            </section>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Score card */}
              <section className="card p-5 fade-up d2">
                <div className="flex items-baseline justify-between"><p className="label">Score</p><p className="text-xs text-ink-3">computed, not guessed</p></div>
                <div className="mt-4"><ScoreRing total={m.score.total} grades={m.score.grades} /></div>
                <p className="mt-4 text-xs text-ink-3">{r.parse.tradeCount} trades · {m.dateRange.from.slice(0, 10)} → {m.dateRange.to.slice(0, 10)} · {r.parse.profile} export, {r.parse.dropped.toLocaleString()} non-trade rows skipped</p>
              </section>

              {/* Equity curve */}
              <section className="card p-5 lg:col-span-2 fade-up d3">
                <div className="flex items-baseline justify-between"><p className="label">Realised P&L, cumulative</p><p className="text-xs text-ink-3">{Object.keys(m.byDay).length} trading days</p></div>
                <EquityCurve trades={trades} highlighted={selectedIds} />
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Breakdowns as bars: click one to filter the table */}
              <section className="card p-5 space-y-5 fade-up d4">
                <div>
                  <p className="label mb-2">By session <span className="normal-case tracking-normal">(broker time)</span></p>
                  <Bars active={filter.session} onPick={(k) => setFilter({ ...filter, session: filter.session === k ? undefined : k, onlyHighlighted: false })}
                    rows={(["asian", "london", "ny"] as const).map((k) => ({ key: k, label: k === "ny" ? "New York" : k === "asian" ? "Asian" : "London", ...m.bySession[k] }))} />
                </div>
                <div>
                  <p className="label mb-2">By exit</p>
                  <Bars active={filter.exitReason} onPick={(k) => setFilter({ ...filter, exitReason: filter.exitReason === k ? undefined : k, onlyHighlighted: false })}
                    rows={(m.available.exitReason ? (["tp", "sl", "manual"] as const) : (["unknown"] as const)).map((k) => ({ key: k, label: k === "tp" ? "Take-profit hit" : k === "sl" ? "Stop-loss hit" : k === "manual" ? "Closed by hand" : "Exit reason not in export", ...m.byExitReason[k] }))} />
                </div>
                <div>
                  <p className="label mb-2">By instrument</p>
                  <Bars rows={Object.entries(m.bySymbol).sort((x, y) => y[1].count - x[1].count).slice(0, 5).map(([k, v]) => ({ key: k, label: k, ...v }))} />
                </div>
              </section>

              {/* Findings + actions */}
              <section className="card p-5 lg:col-span-2 fade-up d5">
                <div className="flex items-baseline justify-between"><p className="label">What the agent found</p><p className="text-xs text-ink-3">{r.findings.length} findings · tap one to see its trades</p></div>
                <ol className="mt-3 space-y-2">
                  {r.findings.map((f, i) => (
                    <FindingCard key={f.id} f={f} index={i} tag={r.tags[f.id]} selected={selected === f.id} print={print}
                      decision={decisionFor(f)} onSelect={() => { setSelected(f.id); setFilter({ onlyHighlighted: true }); }} onDecide={(d) => decide(f, d)} />
                  ))}
                </ol>
              </section>
            </div>

            {/* Coaching report: verdict + rule up front, full text on demand */}
            {(() => { const { verdict, rule, rest } = splitReport(r.report); return (
            <section className="card p-6 fade-up d6">
              <div className="flex items-baseline justify-between"><p className="label">Coach&apos;s verdict</p><p className="text-xs text-ink-3">GPT-4o via OpenRouter · only uses the numbers above</p></div>
              <div className="report mt-3 grid gap-4 lg:grid-cols-3">
                <blockquote className="lg:col-span-2 border-l-4 border-ink pl-4 text-[17px] leading-relaxed"><Markdown text={verdict || r.report.slice(0, 400)} /></blockquote>
                {rule && (
                  <div className="rounded-xl bg-ink p-4 text-white">
                    <p className="text-[11px] uppercase tracking-wider text-neutral-400">This week&apos;s rule</p>
                    <div className="mt-2 text-[15px] leading-relaxed [&_strong]:text-white [&_a]:text-white"><Markdown text={rule} /></div>
                  </div>
                )}
              </div>
              {rest && (
                <div className="mt-4">
                  {(showReport || print) ? <div className="report max-w-3xl text-[15px]"><Markdown text={rest} /></div>
                    : <button className="btn btn-ghost !text-xs" onClick={() => setShowReport(true)}>Read the full report ↓</button>}
                </div>
              )}
              {r.news.some((n) => n.sources.length) && (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="label mb-2">What moved the market on the worst day · via Exa</p>
                  <ul className="grid gap-3 sm:grid-cols-3">
                    {r.news.flatMap((n) => n.sources).map((src) => (
                      <li key={src.url} className="rounded-lg border border-border p-3 text-sm">
                        <a className="font-medium text-accent hover:underline" href={src.url} target="_blank" rel="noreferrer">{src.title}</a>
                        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-ink-2">{src.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            ); })()}

            {/* Trades table */}
            {!print && (
              <section className="card p-5 fade-up d7">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="label">Trades <span className="num normal-case tracking-normal text-ink-2">{visible.length} of {trades.length}</span></p>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {r.appliedFilter && filter.onlyHighlighted && selected === r.findings[0]?.id && <span className="text-xs text-accent">filter applied by the agent</span>}
                    <select className="rounded-md border border-border px-2 py-1" value={filter.session ?? ""} onChange={(e) => setFilter({ ...filter, session: e.target.value || undefined })}>
                      <option value="">All sessions</option><option value="asian">Asian</option><option value="london">London</option><option value="ny">New York</option>
                    </select>
                    <select className="rounded-md border border-border px-2 py-1" value={filter.exitReason ?? ""} onChange={(e) => setFilter({ ...filter, exitReason: e.target.value || undefined })}>
                      <option value="">All exits</option><option value="tp">Take-profit</option><option value="sl">Stop-loss</option><option value="manual">Manual</option>
                    </select>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={!!filter.onlyHighlighted} onChange={(e) => setFilter({ ...filter, onlyHighlighted: e.target.checked })} /> only highlighted</label>
                    <button className="btn btn-ghost !py-1 !px-3 !text-xs" onClick={() => setFilter({})}>Clear</button>
                  </div>
                </div>
                <div className="mt-3 max-h-[480px] overflow-auto">
                  <table className="num w-full text-[13px]">
                    <thead className="sticky top-0 bg-surface text-left text-xs text-ink-3">
                      <tr>{["Open", "Close", "Symbol", "Side", "Lots", "Entry", "Exit", "Exit by", "Profit"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {visible.slice(0, 400).map((t: Trade) => {
                        const hi = selectedIds.has(t.id) || (!selected && highlighted.has(t.id));
                        return (
                          <tr key={t.id} className={`border-t border-border ${hi ? "bg-highlight" : ""}`}>
                            <td className="py-1.5 pr-3 whitespace-nowrap">{t.openTime.replace("T", " ")}</td>
                            <td className="py-1.5 pr-3 whitespace-nowrap">{t.closeTime.replace("T", " ")}</td>
                            <td className="py-1.5 pr-3">{t.symbol}</td>
                            <td className="py-1.5 pr-3 capitalize">{t.type}</td>
                            <td className="py-1.5 pr-3">{t.volume}</td>
                            <td className="py-1.5 pr-3">{t.openPrice}</td>
                            <td className="py-1.5 pr-3">{t.closePrice}</td>
                            <td className="py-1.5 pr-3">{t.exitReason}</td>
                            <td className={`py-1.5 pr-3 text-right ${t.profit >= 0 ? "text-good" : "text-bad"}`}>{money(t.profit)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {visible.length > 400 && <p className="py-2 text-xs text-ink-3">Showing 400 of {visible.length}. Use the filters.</p>}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
