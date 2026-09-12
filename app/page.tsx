"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sources } from "@/components/Sources";

export default function Home() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File | Blob, name: string) {
    setBusy(name);
    setError(null);
    const fd = new FormData();
    fd.append("file", file, name);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Upload failed"); setBusy(null); return; }
    router.push(`/dashboard/${json.id}`);
  }

  async function useSample() {
    setBusy("sample.history.csv");
    const res = await fetch("/sample.history.csv");
    upload(await res.blob(), "sample.history.csv");
  }

  return (
    <main className="min-h-screen px-6">
      <header className="mx-auto flex max-w-5xl items-center justify-between py-6">
        <img src="/logo.png" alt="TradeAudit" className="h-8 w-auto" />
        <a className="text-sm text-ink-3 hover:text-ink" href="https://github.com/MuhammedEasa/tradeaduit" target="_blank" rel="noreferrer">GitHub</a>
      </header>

      <section className="mx-auto max-w-3xl pt-20 pb-12 text-center">
        <p className="label mb-4 fade-up">Agents, everywhere</p>
        <h1 className="fade-up d1 text-5xl font-semibold tracking-tight leading-[1.05] sm:text-6xl">
          An auditor that reads your<br />trading history for you.
        </h1>
        <p className="fade-up d2 mx-auto mt-6 max-w-xl text-lg text-ink-2">
          Upload a broker export. The agent parses it, computes the real numbers, finds your worst habits,
          pulls the news behind your worst day and marks up your dashboard. No chat. No prompts.
        </p>
      </section>

      <section className="mx-auto max-w-xl pb-16">
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f, f.name); }}
          className={`card fade-up d3 flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-14 text-center transition ${drag ? "border-accent bg-muted" : ""}`}
        >
          <input type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, f.name); }} />
          <span className="text-2xl">↑</span>
          <span className="font-medium">{busy ? `Uploading ${busy}…` : "Drop your history CSV here"}</span>
          <span className="text-sm text-ink-3">MQL5 signal exports · MT5 reports · generic CSV with headers</span>
        </label>
        <div className="mt-4 flex items-center justify-center gap-3">
          <button className="btn" onClick={useSample} disabled={!!busy}>Run on the sample history</button>
          <span className="text-sm text-ink-3">830 real XAUUSD trades</span>
        </div>
        {error && <p className="mt-4 text-center text-sm text-bad">{error}</p>}
      </section>

      <Sources />

      <section className="mx-auto grid max-w-5xl gap-6 border-t border-border py-16 sm:grid-cols-3">
        {[
          ["01", "Code does the math", "Every metric, every finding and every trade id is computed in TypeScript. The model only turns numbers into words."],
          ["02", "It acts, you approve", "The agent highlights trades, applies filters, writes a report and proposes journal entries and alerts for you to accept or reject."],
          ["03", "Runs on its own", "Connect a source once. A Trigger.dev schedule pulls it daily, audits only what changed, and retries on failure."],
        ].map(([n, t, d]) => (
          <div key={n}>
            <p className="num text-sm text-ink-3">{n}</p>
            <h3 className="mt-2 font-semibold">{t}</h3>
            <p className="mt-1 text-sm text-ink-2 leading-relaxed">{d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
