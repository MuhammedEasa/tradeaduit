import Link from "next/link";
import { listAudits } from "@/lib/store";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Every audit the agent has run, newest first: manual uploads and auto-synced sources alike.
export default async function AuditsPage() {
  const audits = await listAudits();
  return (
    <main className="min-h-screen px-6 pb-20">
      <Nav right={<Link className="btn" href="/">New audit</Link>} />
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <p className="label">History</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audits</h1>
          <p className="mt-1 text-sm text-ink-2">{audits.length} runs. Auto-synced sources re-audit daily, so the same account shows up as a new row whenever its history changes.</p>
        </div>
        <div className="card overflow-x-auto p-2">
          <table className="w-full table-fixed text-sm">
            <colgroup>{["150px","","110px","130px","64px","110px","56px","","120px"].map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}</colgroup>
            <thead className="text-left text-xs text-ink-3">
              <tr>{["When", "File", "Source", "Job", "Trades", "Net P&L", "Score", "Top finding", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {audits.map((a) => {
                const m = a.result?.metrics;
                const top = a.result?.findings[0];
                return (
                  <tr key={a.id} className="border-t border-border fade-up">
                    <td className="num whitespace-nowrap px-3 py-2 text-ink-2">{new Date(a.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-3 py-2 font-medium"><span className="block truncate" title={a.fileName}>{a.fileName}</span></td>
                    <td className="px-3 py-2 text-ink-2"><span className="block truncate">{a.sourceName ?? <span className="text-ink-3">upload</span>}</span></td>
                    <td className="px-3 py-2"><span className={`whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs ${a.status === "done" ? "text-good" : a.status === "error" ? "text-bad" : "text-accent pulse"}`}>{a.mode === "trigger" ? "Trigger.dev" : "inline"} · {a.status}</span></td>
                    <td className="num px-3 py-2 text-right">{m?.totalTrades ?? "—"}</td>
                    <td className={`num px-3 py-2 text-right ${m ? (m.totalPnL >= 0 ? "text-good" : "text-bad") : ""}`}>{m ? money(m.totalPnL) : "—"}</td>
                    <td className="num px-3 py-2 text-right">{m ? `${m.score.total}` : "—"}</td>
                    <td className="px-3 py-2 text-ink-2"><span className="block truncate" title={top?.title}>{top?.title ?? (a.error ? <span className="text-bad">{a.error}</span> : "—")}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Link className="text-accent hover:underline" href={`/dashboard/${a.id}`}>open</Link>
                      {a.result && <> · <Link className="text-accent hover:underline" href={`/report/${a.id}`}>report</Link></>}
                    </td>
                  </tr>
                );
              })}
              {audits.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-3">No audits yet. <Link className="text-accent" href="/">Run one.</Link></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
