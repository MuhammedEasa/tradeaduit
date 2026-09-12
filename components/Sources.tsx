"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Source } from "@/lib/sources";

// Connect a source once; the agent syncs it on its own (daily schedule + "Sync now").
export function Sources() {
  const [list, setList] = useState<Source[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"url" | "folder">("url");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  const load = async () => setList(await (await fetch("/api/sources", { cache: "no-store" })).json());
  useEffect(() => { load(); setOrigin(window.location.origin); }, []);

  async function add() {
    setError(null); setBusy("add");
    const res = await fetch("/api/sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, kind, url: kind === "url" ? url : undefined }) });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) { setError(json.error); return; }
    setName(""); setUrl("");
    await load();
    if (kind === "url") sync(json.id);
  }
  async function sync(id: string, force = false) {
    setBusy(id);
    await fetch(`/api/sources/${id}/sync${force ? "?force=1" : ""}`, { method: "POST" });
    setBusy(null);
    await load();
  }
  async function remove(id: string) {
    await fetch(`/api/sources/${id}`, { method: "DELETE" });
    await load();
  }


  return (
    <section className="mx-auto max-w-3xl pb-20">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <p className="label">Or connect a source</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Never upload again</h2>
        </div>
        <p className="max-w-sm text-right text-sm text-ink-3">The agent pulls it every day at 06:00, hashes it, and audits only when the file changed.</p>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap gap-2">
          <input className="min-w-40 flex-1 rounded-md border border-border px-3 py-2 text-sm" placeholder="Name, e.g. Gold scalping account" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="rounded-md border border-border px-2 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as "url" | "folder")}>
            <option value="url">URL (broker report, Drive/Dropbox link, raw GitHub)</option>
            <option value="folder">Folder on my computer (MT5 exports)</option>
          </select>
          {kind === "url" && <input className="min-w-64 flex-[2] rounded-md border border-border px-3 py-2 text-sm num" placeholder={`${origin}/sample.history.csv`} value={url} onChange={(e) => setUrl(e.target.value)} />}
          <button className="btn" disabled={busy === "add" || !name || (kind === "url" && !url)} onClick={add}>Connect</button>
        </div>
        {kind === "folder" && <p className="mt-2 text-xs text-ink-3">After connecting, run the local sync agent: <code className="num">npx tsx scripts/sync.ts &quot;&lt;folder&gt;&quot; &lt;sourceId&gt;</code>. It watches the folder and pushes any new export here.</p>}
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
      </div>

      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm fade-up">
              <span className={`h-2 w-2 rounded-full ${s.lastOutcome === "error" ? "bg-bad" : s.lastOutcome ? "bg-good" : "bg-ink-3"} ${busy === s.id ? "pulse" : ""}`} />
              <span className="font-medium">{s.name}</span>
              <span className="num text-xs text-ink-3">{s.kind === "url" ? s.url : `folder · id ${s.id}`}</span>
              <span className="ml-auto text-xs text-ink-3">
                {busy === s.id ? "syncing…" : s.lastCheckedAt ? `${s.lastOutcome === "new-audit" ? "new audit" : s.lastOutcome === "unchanged" ? "unchanged" : `error: ${s.lastError}`} · ${new Date(s.lastCheckedAt).toLocaleTimeString()} · ${s.syncCount} audits` : "never synced"}
              </span>
              {s.lastAuditId && <Link className="text-accent hover:underline" href={`/dashboard/${s.lastAuditId}`}>open</Link>}
              {s.kind === "url" && <button className="btn btn-ghost !px-3 !py-1 !text-xs" disabled={!!busy} onClick={() => sync(s.id)}>Sync now</button>}
              <button className="text-xs text-ink-3 hover:text-bad" onClick={() => remove(s.id)}>remove</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
