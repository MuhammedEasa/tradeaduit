// lib/kv.ts — the one storage seam. Two backends behind the same 5 calls:
//   - file (default): JSON under ./data, atomic writes. Local dev, single machine.
//   - upstash: Redis over REST when UPSTASH_REDIS_REST_URL + TOKEN are set. Vercel / Cloud Run / anything stateless.
// Everything else in the app (audits, sources, journal, alerts) only talks to get/set/del/keys.

import { mkdir, readFile, writeFile, rename, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  // Serialises read-modify-write on one key (in-process for file; Redis backend relies on single-writer patterns).
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const safe = (key: string) => key.replace(/[^a-zA-Z0-9_.-]/g, "_");   // ":" is illegal in Windows file names

function fileKV(): KV {
  const locks = new Map<string, Promise<void>>();
  const file = (key: string) => path.join(DATA_DIR, `${safe(key)}.json`);
  return {
    async get(key) {
      try { return JSON.parse(await readFile(file(key), "utf8")); } catch { return null; }
    },
    async set(key, value) {
      await mkdir(DATA_DIR, { recursive: true });
      const tmp = `${file(key)}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(value), "utf8");
      await rename(tmp, file(key));
    },
    async del(key) {
      await unlink(file(key)).catch(() => {});
    },
    async keys(prefix) {
      await mkdir(DATA_DIR, { recursive: true });
      const p = safe(prefix);
      return (await readdir(DATA_DIR)).filter((f) => f.startsWith(p) && f.endsWith(".json")).map((f) => f.slice(0, -5));
    },
    async withLock(key, fn) {
      const prev = locks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const next = new Promise<void>((r) => (release = r));
      locks.set(key, prev.then(() => next));
      await prev;
      try { return await fn(); } finally { release(); if (locks.get(key) === next) locks.delete(key); }
    },
  };
}

// Vercel's Upstash integration injects UPSTASH_REDIS_REST_*; the older KV integration injects KV_REST_API_*.
// Accept either so the deploy works whichever one the dashboard created.
const redisUrl = () => env("UPSTASH_REDIS_REST_URL") || env("KV_REST_API_URL");
const redisToken = () => env("UPSTASH_REDIS_REST_TOKEN") || env("KV_REST_API_TOKEN");

function upstashKV(): KV {
  // Lazy import keeps the dependency out of the file-backed path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Redis } = require("@upstash/redis") as typeof import("@upstash/redis");
  const redis = new Redis({ url: redisUrl(), token: redisToken() });
  const ns = process.env.KV_NAMESPACE ?? "tradeaudit";
  const k = (key: string) => `${ns}:${key}`;
  return {
    async get<T>(key: string) { return (await redis.get<T>(k(key))) ?? null; },
    async set(key, value) { await redis.set(k(key), value); },
    async del(key) { await redis.del(k(key)); },
    async keys(prefix) {
      const out: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, { match: `${k(prefix)}*`, count: 200 });
        out.push(...batch.map((x) => x.slice(ns.length + 1)));
        cursor = String(next);
      } while (cursor !== "0");
      return out;
    },
    async withLock(key, fn) {
      // Best-effort lock: SET NX with a short TTL, retry a few times. Good enough for step appends from one worker.
      const lockKey = k(`lock:${key}`);
      for (let i = 0; i < 40; i++) {
        const ok = await redis.set(lockKey, "1", { nx: true, px: 5000 });
        if (ok) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      try { return await fn(); } finally { await redis.del(lockKey); }
    },
  };
}

let instance: KV | null = null;
export function kv(): KV {
  if (!instance) instance = redisUrl() && redisToken() ? upstashKV() : fileKV();
  return instance;
}
export const backendName = () => (redisUrl() ? "upstash" : "file");
