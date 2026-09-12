"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AuditView } from "@/lib/runner";
import type { ActionEntry } from "@/lib/store";
import type { Finding, Trade } from "@/lib/types";
import { EquityCurve } from "./EquityCurve";
import { CountUp } from "./CountUp";
import { Markdown } from "./Markdown";

type Data = AuditView & { actions: ActionEntry[] };

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SEV: Record<Finding["severity"], string> = { high: "text-bad", medium: "text-warn", low: "text-ink-3" };
const GRADE_COLOR = (g: string) => (g === "A" || g === "B" ? "text-good" : g === "C" ? "text-warn" : "text-bad");

function sessionOf(iso: string) { const h = parseInt(iso.slice(11, 13), 10); return h < 8 ? "asian" : h < 16 ? "london" : "ny"; }

export function Dashboard({ id, print = false }: { id: string; print?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<{ session?: string; exitReason?: string; onlyHighlighted?: boolean }>({});
  const markedUp = useRef(false);
  const failures = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);

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
  if (!data) return <main className="p-10 text-ink-3 pulse">Starting the agent…</main>;

  const m = r?.metrics;

  return (
    <main className="min-h-screen px-6 pb-20">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center"><img src="/logo.png" alt="TradeAudit" className="h-7 w-auto" /></Link>
          <span className="text-ink-3">/</span>
          <span className="text-sm text-ink-2">{data.fileName}</span>
          {data.sourceName && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-ink-2">auto-synced · {data.sourceName}</span>}
          <span className={`rounded-full px-2 py-0.5 text-xs ${data.status === "done" ? "bg-muted text-good" : data.status === "error" ? "bg-muted text-bad" : "bg-muted text-accent pulse"}`}>
            {data.status === "done" ? "audit complete" : data.status === "error" ? "audit failed" : "agent working"}
          </span>
        </div>
        <div className="no-print flex items-center gap-2">
          <span className="text-xs text-ink-3">{data.mode === "trigger" ? "Trigger.dev job" : "inline job"}{data.runId ? ` · ${data.runId.slice(0, 12)}` : ""}</span>
          {!print && <Link className="btn btn-ghost" href="/journal">Journal</Link>}
          {r && !print && <Link className="btn btn-ghost" href={`/report/${id}`}>Report</Link>}
          {r && print && <button className="btn" onClick={() => window.print()}>Export PDF</button>}
          {!print && <Link className="btn" href="/">New audit</Link>}
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6">
        {/* Activity feed: what the agent is doing, live */}
        {!print && (
          <section className="mac">
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
                <p className="label">Score</p>
                <div className="mt-2 flex items-end gap-2"><span className="num text-5xl font-semibold"><CountUp value={m.score.total} format={(n) => String(Math.round(n))} duration={1400} /></span><span className="mb-2 text-ink-3">/100</span></div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {Object.entries(m.score.grades).map(([k, g]) => (
                    <div key={k} className={`pop d${["profitability","risk","drawdown","consistency"].indexOf(k) + 5}`}><p className="text-xs capitalize text-ink-3">{k}</p><p className={`num text-2xl font-semibold ${GRADE_COLOR(g)}`}>{g}</p></div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-ink-3">{r.parse.profile} · {r.parse.tradeCount} trades · {r.parse.dropped.toLocaleString()} rows skipped · {m.dateRange.from.slice(0, 10)} → {m.dateRange.to.slice(0, 10)}</p>
              </section>

              {/* Equity curve */}
              <section className="card p-5 lg:col-span-2 fade-up d3">
                <div className="flex items-baseline justify-between"><p className="label">Realised P&L, cumulative</p><p className="text-xs text-ink-3">{Object.keys(m.byDay).length} trading days</p></div>
                <EquityCurve trades={trades} highlighted={selectedIds} />
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
              {/* Breakdown tables */}
              <section className="card p-5 space-y-5 fade-up d4">
                <div>
                  <p className="label mb-2">By session (broker time)</p>
                  <table className="w-full text-sm"><tbody>
                    {(["asian", "london", "ny"] as const).map((s) => (
                      <tr key={s} className={`border-t border-border ${filter.session === s ? "bg-muted" : ""}`}>
                        <td className="py-1.5 capitalize">{s === "ny" ? "New York" : s}</td>
                        <td className="num py-1.5 text-right text-ink-3">{m.bySession[s].count}</td>
                        <td className="num py-1.5 text-right text-ink-3">{m.bySession[s].winRate}%</td>
                        <td className={`num py-1.5 text-right ${m.bySession[s].pnl >= 0 ? "text-good" : "text-bad"}`}>{money(m.bySession[s].pnl)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
                <div>
                  <p className="label mb-2">By exit</p>
                  <table className="w-full text-sm"><tbody>
                    {(m.available.exitReason ? (["tp", "sl", "manual"] as const) : (["unknown"] as const)).map((s) => (
                      <tr key={s} className={`border-t border-border ${filter.exitReason === s ? "bg-muted" : ""}`}>
                        <td className="py-1.5">{s === "tp" ? "Take-profit hit" : s === "sl" ? "Stop-loss hit" : s === "manual" ? "Closed manually" : "Exit reason not in export"}</td>
                        <td className="num py-1.5 text-right text-ink-3">{r.metrics.byExitReason[s].count}</td>
                        <td className="num py-1.5 text-right text-ink-3">{r.metrics.byExitReason[s].winRate}%</td>
                        <td className={`num py-1.5 text-right ${r.metrics.byExitReason[s].pnl >= 0 ? "text-good" : "text-bad"}`}>{money(r.metrics.byExitReason[s].pnl)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
                <div>
                  <p className="label mb-2">By symbol</p>
                  <table className="w-full text-sm"><tbody>
                    {Object.entries(m.bySymbol).sort((a, b) => b[1].count - a[1].count).slice(0, 6).map(([s, v]) => (
                      <tr key={s} className="border-t border-border">
                        <td className="num py-1.5">{s}</td><td className="num py-1.5 text-right text-ink-3">{v.count}</td><td className="num py-1.5 text-right text-ink-3">{v.winRate}%</td>
                        <td className={`num py-1.5 text-right ${v.pnl >= 0 ? "text-good" : "text-bad"}`}>{money(v.pnl)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </section>

              {/* Findings + actions */}
              <section className="card p-5 lg:col-span-2 fade-up d5">
                <div className="flex items-baseline justify-between"><p className="label">Findings</p><p className="text-xs text-ink-3">{r.findings.length} detected · click one to highlight its trades</p></div>
                <ol className="mt-3 divide-y divide-border">
                  {r.findings.map((f, i) => {
                    const d = decisionFor(f);
                    return (
                      <li key={f.id} id={f.id} className={`py-3 fade-up d${Math.min(8, i + 1)} transition-colors ${selected === f.id ? "bg-muted -mx-3 px-3 rounded-lg" : ""}`}>
                        <button className="flex w-full items-start gap-3 text-left" onClick={() => { setSelected(f.id); setFilter({ onlyHighlighted: true }); }}>
                          <span className="num mt-0.5 text-xs text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                          <span className="flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className={`text-[11px] font-medium uppercase tracking-wider ${SEV[f.severity]}`}>{f.severity}</span>
                              {r.tags[f.id] && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-ink-2">{r.tags[f.id]}</span>}
                              <span className="font-medium">{f.title}</span>
                            </span>
                            <span className="mt-1 block text-sm leading-relaxed text-ink-2">{f.evidence}</span>
                          </span>
                        </button>
                        {f.suggestedAction && (
                          <div className="no-print mt-2 flex flex-wrap items-center gap-2 pl-8">
                            <span className="text-sm text-ink-2">{f.suggestedAction.label}</span>
                            {d ? (
                              <span className={`text-xs ${d.decision === "approved" ? "text-good" : "text-ink-3"}`}>{d.decision === "approved" ? <>✓ {d.type === "journal" ? "added to journal" : "alert set"} · <Link className="underline" href="/journal">view</Link></> : "dismissed"}</span>
                            ) : (
                              <>
                                <button className="btn !py-1 !px-3 !text-xs" onClick={() => decide(f, "approved")}>Approve</button>
                                <button className="btn btn-ghost !py-1 !px-3 !text-xs" onClick={() => decide(f, "rejected")}>Reject</button>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>

            {/* Coaching report + news */}
            <section className="card p-6 fade-up d6">
              <div className="flex items-baseline justify-between"><p className="label">Coaching report</p><p className="text-xs text-ink-3">written by GPT-4o via OpenRouter from the numbers above · no figure is generated by the model</p></div>
              <div className="report mt-2 max-w-3xl text-[15px]"><Markdown text={r.report} /></div>
              {r.news.some((n) => n.sources.length) && (
                <div className="mt-6 border-t border-border pt-4">
                  <p className="label mb-2">What moved the market on the worst day · via Exa</p>
                  <ul className="grid gap-3 sm:grid-cols-3">
                    {r.news.flatMap((n) => n.sources).map((s) => (
                      <li key={s.url} className="rounded-lg border border-border p-3 text-sm">
                        <a className="font-medium text-accent hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                        <p className="mt-1 text-xs leading-relaxed text-ink-2">{s.snippet}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

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
