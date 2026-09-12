"use client";

import { useEffect, useState } from "react";
import type { AuditStep, Finding } from "@/lib/types";
import type { Grade } from "@/lib/metrics";

export const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const STAGES = ["Parse history", "Compute metrics", "Detect patterns", "Compare with last audit", "Classify findings", "Fetch news", "Write report", "Mark up dashboard"] as const;
const SHORT: Record<string, string> = { "Parse history": "Parse", "Compute metrics": "Metrics", "Detect patterns": "Patterns", "Compare with last audit": "Compare", "Classify findings": "Classify", "Fetch news": "News", "Write report": "Report", "Mark up dashboard": "Mark up" };

export function stageState(steps: AuditStep[], name: string): "pending" | "running" | "done" | "error" {
  const mine = steps.filter((s) => s.name === name);
  if (mine.length === 0) return "pending";
  const last = mine[mine.length - 1];
  return last.status === "done" ? "done" : last.status === "error" ? "error" : "running";
}

// Live seconds counter; stops when the run finishes. Kept out of render so it stays pure.
function useElapsed(startedAt: string, frozen: boolean) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const tick = () => setSecs(Math.max(0, Math.round((Date.now() - Date.parse(startedAt)) / 1000)));
    tick();
    if (frozen) return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt, frozen]);
  return secs;
}

export function StageTracker({ steps, status, startedAt }: { steps: AuditStep[]; status: string; startedAt: string }) {
  const shown = STAGES.filter((n) => n !== "Compare with last audit" || steps.some((s) => s.name === n));
  const done = shown.filter((n) => stageState(steps, n) === "done").length;
  const pct = status === "done" ? 100 : Math.round((done / shown.length) * 100);
  const finished = status === "done" || status === "error";
  const live = useElapsed(startedAt, finished);
  // Once finished, show how long the run actually took, not how long ago it started.
  const last = steps[steps.length - 1];
  const secs = finished && last ? Math.max(0, Math.round((Date.parse(last.ts) - Date.parse(steps[0].ts)) / 1000)) : live;
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className={`relative flex h-3 w-3 ${status === "done" ? "" : "pulse"}`}><span className={`inline-flex h-3 w-3 rounded-full ${status === "done" ? "bg-good" : status === "error" ? "bg-bad" : "bg-accent"}`} /></span>
          <p className="font-semibold">{status === "done" ? "Audit complete" : status === "error" ? "Audit failed" : "Agent is working"}</p>
          <p className="text-sm text-ink-3">{status === "done" ? `${shown.length} steps` : `step ${Math.min(done + 1, shown.length)} of ${shown.length}`}</p>
        </div>
        <p className="num text-sm text-ink-3">{pct}% · {secs}s</p>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
      <ol className="mt-4 flex flex-wrap gap-2">
        {shown.map((n) => {
          const st = stageState(steps, n);
          return (
            <li key={n} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${st === "done" ? "border-good/30 bg-good/5 text-good" : st === "running" ? "border-accent bg-accent/5 text-accent" : st === "error" ? "border-bad/40 text-bad" : "border-border text-ink-3"}`}>
              <span className={st === "running" ? "pulse" : ""}>{st === "done" ? "✓" : st === "running" ? "●" : st === "error" ? "!" : "○"}</span>{SHORT[n]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`spin h-3.5 w-3.5 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ h = "h-24", className = "" }: { h?: string; className?: string }) {
  return <div className={`card ${h} ${className} animate-pulse bg-muted/60`} />;
}

const gradeColor = (g: Grade) => (g === "A" || g === "B" ? "text-good" : g === "C" ? "text-warn" : "text-bad");
export function ScoreRing({ total, grades }: { total: number; grades: Record<string, Grade> }) {
  const r = 44, c = 2 * Math.PI * r;
  const color = total >= 70 ? "#1e8e3e" : total >= 50 ? "#b26a00" : "#d93025";
  const word = total >= 85 ? "Excellent" : total >= 70 ? "Good" : total >= 55 ? "Fair" : total >= 40 ? "Weak" : "Poor";
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f0f0f0" strokeWidth="9" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - total / 100)} style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.2,.7,.2,1)" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="num text-3xl font-semibold leading-none">{total}</span><span className="mt-1 text-[10px] uppercase tracking-wider text-ink-3">{word}</span></div>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2">
        {Object.entries(grades).map(([k, g]) => (
          <div key={k} className="flex items-center justify-between border-b border-border pb-1"><span className="text-xs capitalize text-ink-2">{k}</span><span className={`num text-lg font-semibold ${gradeColor(g)}`}>{g}</span></div>
        ))}
      </div>
    </div>
  );
}

export function Bars({ rows, active, onPick }: { rows: { key: string; label: string; count: number; pnl: number; winRate: number }[]; active?: string; onPick?: (k: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnl)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className={`rounded-lg px-2 py-1.5 transition-colors ${active === r.key ? "bg-muted" : ""} ${onPick ? "cursor-pointer hover:bg-muted/60" : ""}`} onClick={() => onPick?.(r.key)}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium">{r.label}</span>
            <span className={`num ${r.pnl >= 0 ? "text-good" : "text-bad"}`}>{money(r.pnl)}</span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${r.pnl >= 0 ? "bg-good" : "bg-bad"}`} style={{ width: `${Math.max(3, (Math.abs(r.pnl) / max) * 100)}%`, transition: "width .8s ease-out" }} /></div>
            <span className="num w-28 shrink-0 whitespace-nowrap text-right text-[11px] text-ink-3">{r.count} · {r.winRate}% win</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SEV_BAR: Record<Finding["severity"], string> = { high: "bg-bad", medium: "bg-warn", low: "bg-ink-3" };
const SEV_TEXT: Record<Finding["severity"], string> = { high: "text-bad", medium: "text-warn", low: "text-ink-3" };

export function FindingCard({ f, index, tag, selected, decision, busy, onSelect, onDecide, print }: {
  f: Finding; index: number; tag?: string; selected: boolean;
  decision?: { decision: "approved" | "rejected"; type: "journal" | "alert" };
  busy?: boolean;
  onSelect: () => void; onDecide: (d: "approved" | "rejected") => void; print?: boolean;
}) {
  const [open, setOpen] = useState(print ?? false);
  return (
    <li id={f.id} className={`relative overflow-hidden rounded-xl border transition-all fade-up d${Math.min(8, index + 1)} ${selected ? "border-ink shadow-[0_1px_3px_rgba(0,0,0,.08)]" : "border-border"}`}>
      <span className={`absolute left-0 top-0 h-full w-1 ${SEV_BAR[f.severity]}`} />
      <div className="flex flex-col gap-3 p-4 pl-5 sm:flex-row sm:items-start">
        <button onClick={onSelect} className="flex min-w-0 flex-1 items-start gap-4 text-left">
          {f.stat && (
            <div className="w-28 shrink-0">
              <p className={`num font-semibold leading-none ${f.stat.value.length > 7 ? "text-lg" : f.stat.value.length > 4 ? "text-xl" : "text-2xl"} ${SEV_TEXT[f.severity]}`}>{f.stat.value}</p>
              <p className="mt-1.5 text-[11px] leading-tight text-ink-3">{f.stat.label}</p>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${SEV_TEXT[f.severity]}`}>{f.severity}</span>
              {tag && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-ink-2">{tag}</span>}
              {f.tradeIds.length > 0 && <span className="text-[11px] text-ink-3">{f.tradeIds.length} trades{selected ? " · shown below" : ""}</span>}
            </div>
            <p className="mt-1 font-medium leading-snug">{f.title}</p>
            {open ? (
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{f.evidence}</p>
            ) : (
              <span className="mt-1 inline-block text-xs text-accent" onClick={(e) => { e.stopPropagation(); setOpen(true); }}>why? ↓</span>
            )}
          </div>
        </button>
        {f.suggestedAction && (
          <div className="no-print flex shrink-0 flex-col items-stretch gap-1.5 sm:w-52">
            <p className="text-[11px] leading-tight text-ink-2"><span className="font-medium text-ink">{f.suggestedAction.type === "journal" ? "Journal rule" : "Alert"}:</span> {f.suggestedAction.label.replace(/^(Journal|Alert):\s*/, "")}</p>
            {decision ? (
              <span className={`text-xs ${decision.decision === "approved" ? "text-good" : "text-ink-3"}`}>{decision.decision === "approved" ? `✓ ${decision.type === "journal" ? "added to journal" : "alert set"}` : "dismissed"}</span>
            ) : busy ? (
              <span className="flex items-center gap-1.5 text-xs text-ink-2"><Spinner /> Saving…</span>
            ) : (
              <div className="flex gap-1.5">
                <button className="btn !px-3 !py-1 !text-xs" onClick={() => onDecide("approved")}>Approve</button>
                <button className="btn btn-ghost !px-3 !py-1 !text-xs" onClick={() => onDecide("rejected")}>Reject</button>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function splitReport(md: string): { verdict: string; rule: string; rest: string } {
  const sections = md.split(/^##\s+/m).filter(Boolean);
  const get = (name: RegExp) => sections.find((s) => name.test(s.split("\n")[0] ?? ""))?.split("\n").slice(1).join("\n").trim() ?? "";
  const verdict = get(/verdict/i);
  const rule = get(/rule/i);
  const rest = sections.filter((s) => !/verdict|rule/i.test(s.split("\n")[0] ?? "")).map((s) => "## " + s).join("\n");
  return { verdict, rule, rest };
}
