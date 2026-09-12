"use client";

import { useMemo, useState } from "react";
import type { Trade } from "@/lib/types";

// Single-series cumulative P&L line. 2px stroke, recessive grid, crosshair + tooltip on hover.
// Highlighted trade ids get an 8px marker so a selected finding is visible on the curve.
export function EquityCurve({ trades, highlighted }: { trades: Trade[]; highlighted: Set<string> }) {
  const W = 800, H = 220, PL = 56, PR = 12, PT = 12, PB = 26;
  const [hover, setHover] = useState<number | null>(null);

  const pts = useMemo(() => {
    const sorted = [...trades].sort((a, b) => a.closeTime.localeCompare(b.closeTime));
    const out: { i: number; t: Trade; eq: number }[] = [];
    sorted.forEach((t, i) => out.push({ i, t, eq: (out[i - 1]?.eq ?? 0) + t.profit }));
    return out;
  }, [trades]);

  if (pts.length < 2) return <div className="h-[220px]" />;

  const min = Math.min(0, ...pts.map((p) => p.eq)), max = Math.max(0, ...pts.map((p) => p.eq));
  const x = (i: number) => PL + (i / (pts.length - 1)) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v - min) / (max - min || 1)) * (H - PT - PB);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.eq).toFixed(1)}`).join(" ");
  const ticks = [min, (min + max) / 2, max];
  const hp = hover != null ? pts[hover] : null;
  const fmt = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(0)}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="Cumulative realised P&L"
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(pts.length - 1, Math.round(((px - PL) / (W - PL - PR)) * (pts.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#e5e5e5" strokeWidth={1} />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#737373" className="num">{fmt(v)}</text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} stroke="#a3a3a3" strokeWidth={1} strokeDasharray="3 3" />
        <text x={PL} y={H - 8} fontSize={11} fill="#737373">{pts[0].t.closeTime.slice(0, 10)}</text>
        <text x={W - PR} y={H - 8} fontSize={11} fill="#737373" textAnchor="end">{pts[pts.length - 1].t.closeTime.slice(0, 10)}</text>
        <path d={path} className="draw" fill="none" stroke="#0066ff" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.filter((p) => highlighted.has(p.t.id)).map((p) => (
          <circle key={p.t.id} className="pop" style={{ animationDelay: `${1.2 + (p.i / pts.length) * 0.8}s`, transformOrigin: `${x(p.i)}px ${y(p.eq)}px` }} cx={x(p.i)} cy={y(p.eq)} r={4} fill="#d93025" stroke="#fff" strokeWidth={2} />
        ))}
        {hp && (
          <g>
            <line x1={x(hp.i)} x2={x(hp.i)} y1={PT} y2={H - PB} stroke="#0a0a0a" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={x(hp.i)} cy={y(hp.eq)} r={4} fill="#0066ff" stroke="#fff" strokeWidth={2} />
          </g>
        )}
      </svg>
      {hp && (
        <div className="pointer-events-none absolute top-2 rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-sm"
          style={{ left: `${(x(hp.i) / W) * 100}%`, transform: x(hp.i) > W * 0.7 ? "translateX(-110%)" : "translateX(12px)" }}>
          <p className="num text-ink-3">{hp.t.closeTime.replace("T", " ")}</p>
          <p className="num font-medium">Cumulative {fmt(hp.eq)}</p>
          <p className="num text-ink-2">{hp.t.symbol} {hp.t.type} {hp.t.volume} · {hp.t.exitReason} · <span className={hp.t.profit >= 0 ? "text-good" : "text-bad"}>{fmt(hp.t.profit)}</span></p>
        </div>
      )}
    </div>
  );
}
