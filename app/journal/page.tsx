import Link from "next/link";
import { listActions } from "@/lib/store";

export const dynamic = "force-dynamic";

// The trader's journal: every rule they approved from an audit, and every alert they set.
export default async function JournalPage() {
  const all = (await listActions()).filter((a) => a.decision === "approved").sort((a, b) => b.ts.localeCompare(a.ts));
  const journal = all.filter((a) => a.type === "journal");
  const alerts = all.filter((a) => a.type === "alert");

  return (
    <main className="min-h-screen px-6 pb-20">
      <header className="mx-auto flex max-w-4xl items-center justify-between py-5">
        <Link href="/" className="flex items-center"><img src="/logo.png" alt="TradeAudit" className="h-7 w-auto" /></Link>
        <Link className="btn btn-ghost" href="/">Home</Link>
      </header>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="label">Your commitments</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Journal &amp; alerts</h1>
          <p className="mt-1 text-sm text-ink-2">Everything here was proposed by the agent from your own trades and approved by you. Nothing is added without your say.</p>
        </div>
        <Section title="Journal rules" hint="No rules yet. Approve a journal action on a finding and it appears here." items={journal} />
        <Section title="Alert rules" hint="No alerts yet. Approve an alert action on a finding and it appears here." items={alerts} />
      </div>
    </main>
  );
}

type Item = Awaited<ReturnType<typeof listActions>>[number];

function Section({ title, hint, items }: { title: string; hint: string; items: Item[] }) {
  return (
    <section className="card p-5 fade-up">
      <div className="flex items-baseline justify-between"><p className="label">{title}</p><p className="text-xs text-ink-3">{items.length}</p></div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">{hint}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="text-good">✓</span>
              <span className="font-medium">{a.label.replace(/^(Journal|Alert):\s*/, "")}</span>
              <span className="ml-auto num text-xs text-ink-3">{new Date(a.ts).toLocaleString()}</span>
              <Link className="text-xs text-accent hover:underline" href={`/dashboard/${a.auditId}#${a.findingId}`}>from audit {a.auditId}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
