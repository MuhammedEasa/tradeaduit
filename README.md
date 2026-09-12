# TradeAudit

**An agent that audits your trading history on its own.** Upload a broker export; the agent parses it, computes the real numbers, finds your worst habits, pulls the news behind your worst day, writes a coaching report, marks up the dashboard, and asks you to approve fixes. Then it re-runs every day.

Built from scratch at AI Tinkerers **"Agents, Everywhere"**, 12 Sep 2026.

## Why it is an agent, not a chatbot

Nobody types a question. The agent **observes → decides → acts**:

1. **Observes** a raw CSV (MQL5 signal export / MT5 report / generic).
2. **Decides** what matters by running 11 pattern detectors over computed metrics and ranking by severity.
3. **Acts**: fetches news for the worst day, writes the report, **highlights the trades behind the top finding and applies a filter on the dashboard**, and **proposes actions** (journal entries, alert rules) that a human approves or rejects.
4. **Feeds itself**: connect a **source** once (a broker report URL or a Drive/Dropbox direct link; self-hosters can also push files with the `scripts/sync.ts` folder agent). A Trigger.dev schedule pulls every source daily, hashes the file, and audits only when it changed. After the first setup nobody uploads anything.

## Code computes, the LLM explains

Every number on screen is produced in TypeScript (`lib/metrics.ts`, `lib/findings.ts`). The model receives only the computed JSON and is instructed that every figure it writes must appear verbatim in that JSON. It never sees raw trades and never does arithmetic. If the LLM or the news API is down, the audit still completes with a computed fallback report.

## What it found in the sample (830 real XAUUSD scalps)

| Finding | Evidence |
|---|---|
| Manual closes win 5% of the time | 117 hand-closed trades netted −$576; the 713 trades left to hit SL/TP netted +$3,792 (72% win rate) |
| Stops hit 1.9× more than targets | 468 SL exits vs 245 TP exits |
| 61% of trades stacked | 506 trades opened in same-second clusters (up to 8 positions at once) |
| Worst day 2026‑04‑23 | −$177.81; Exa found the FXStreet coverage: yields + Hormuz tension hit gold |
| 31 revenge re-entries | re-entered within 5 min of a loss at ≥ size, 42% win rate vs 63% overall |

## Architecture

```
upload CSV ─► POST /api/upload ─► Trigger.dev task "audit-csv"  (fallback: inline job)
                                       │  parse ─► metrics ─► findings ─► tag (gpt-4o-mini) ─► Exa news ─► report (gpt-4o)
                                       │  each step → run metadata (retries on failure)
dashboard ◄─ polls GET /api/audit/:id ◄┘  live activity feed · stat tiles · equity curve · findings · report · actions
                                          POST /api/actions  → journal / alert store
sources: URL (pulled) or folder (pushed by scripts/sync.ts) ─► hash compare ─► audit only if changed
schedule "daily-sync" (06:00) ─► POST /api/sources/sync-all ─► every source, every day
/report/:id → print-styled page → Export PDF
```

| File | Job |
|---|---|
| `lib/parse.ts` | CSV **normalizer**: BOM/delimiter sniff, header profiles (`mql5-signals`, generic fuzzy fallback), value normalization, drops pending/balance rows |
| `lib/metrics.ts` | Pure metrics: win rate, PF, expectancy, drawdown, session/hour/exit/symbol/day breakdowns, stacking, revenge, hold asymmetry, score card |
| `lib/findings.ts` | 11 general-purpose detectors → ranked `Finding[]` with evidence + trade ids + suggested action |
| `lib/news.ts` | Exa search for the worst day, fails soft |
| `lib/llm.ts` | OpenRouter → OpenAI: cheap model tags, strong model writes the report from computed JSON only |
| `lib/audit.ts` | The pipeline with step logging and retries |
| `trigger/audit.ts` | Trigger.dev task + daily sync schedule |
| `lib/sources.ts`, `scripts/sync.ts` | Connected sources (URL pull / folder push), change detection, local sync agent |
| `lib/runner.ts`, `lib/store.ts` | Job start/poll, JSON store for audits, journal, alerts |
| `components/Dashboard.tsx` | The dashboard the agent marks up |

## The contract

```ts
type Trade = { id; openTime; closeTime; symbol; type: "buy"|"sell"; volume; openPrice; closePrice; sl; tp; commission; swap; profit; exitReason: "sl"|"tp"|"manual" };
type Finding = { id; severity: "high"|"medium"|"low"; title; evidence; tradeIds: string[]; suggestedAction?: { type: "journal"|"alert"; label } };
type AuditStep = { name; status: "running"|"done"|"error"; detail?; ts };
type AuditResult = { metrics: Metrics; findings: Finding[]; news; report: string; steps: AuditStep[] };
```

## Sponsors: what each one actually does

| Sponsor | Role |
|---|---|
| **OpenRouter** | Gateway for every LLM call (`lib/llm.ts`) |
| **OpenAI** | `gpt-4o-mini` classifies findings; `gpt-4o` writes the coaching report from computed numbers |
| **Exa** | Finds what moved the market on the trader's worst day, and powers the live headline ticker for the instruments you trade (`lib/news.ts`) |
| **Trigger.dev** | The agent's spine: durable task, per-step metadata, retries, daily schedule (`trigger/audit.ts`) |
| **Google Cloud Run** | Deployment target (`Dockerfile`) |

## Run it

```bash
npm install
cp .env.example .env        # OPENROUTER_API_KEY, EXA_API_KEY, TRIGGER_SECRET_KEY, TRIGGER_PROJECT_REF
npm run dev                 # http://localhost:3000  → "Run on the sample history"
npx trigger.dev@latest dev  # optional: runs the audit as a Trigger.dev job; without it the job runs inline
npx tsx scripts/check.ts    # parser + metrics + findings on sample.history.csv, no keys needed
npx tsx --env-file=.env scripts/run-audit.ts   # full pipeline in the terminal
npx tsx scripts/sync.ts "<folder>" <sourceId>  # local sync agent: watches a folder, pushes new exports
```

Supports MQL5 signal exports and MT5 history reports; header profiles in `lib/parse.ts` are extensible. Sessions are in broker server time.

## Deploy (free): Vercel + Upstash + Trigger.dev cloud

Storage is one seam (`lib/kv.ts`): local JSON files by default, Upstash Redis when `UPSTASH_REDIS_REST_URL/TOKEN` are set. The audit job runs in Trigger.dev's cloud, so the web app itself can be stateless.

1. **Trigger.dev**: `npx trigger.dev@latest deploy` → copy the **prod** secret key from the dashboard.
2. **Upstash**: create a free Redis database (Vercel marketplace → Upstash, or upstash.com) → copy REST URL + token.
3. **Vercel**: import the repo, set env vars `OPENROUTER_API_KEY`, `EXA_API_KEY`, `TRIGGER_SECRET_KEY` (prod), `TRIGGER_PROJECT_REF`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `APP_URL=https://<your-app>.vercel.app` → deploy.
4. In Trigger.dev, set the same `APP_URL` on the prod environment so the daily sync can call the app.

Google Cloud Run works the same way with the included `Dockerfile` (needs a billing account); the Redis vars replace the local disk there too.

## Built today

Everything in this repository was written during the hackathon (11:15–14:45). Libraries used: Next.js, Tailwind, papaparse, exa-js, openai, @trigger.dev/sdk.

This tool audits past behaviour only. It gives no signals, predictions or trade advice.
