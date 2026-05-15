/**
 * Dense wallet SOL balance over time from chain history (Helius getTransactionsForAddress),
 * with a small getTransaction fallback on generic RPCs. Cached under DATA_DIR.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { getDataDir } from "./config.js";
import { loadKeypair } from "./wallet.js";

const LAMPORTS_PER_SOL = 1e9;

export interface BalanceHistoryPoint {
  timestamp: string;
  balanceSol: number;
}

interface CacheFile {
  points: BalanceHistoryPoint[];
  savedAt: string;
}

const CACHE_NAME = "balance-from-chain-cache.json";

function cachePath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, CACHE_NAME);
}

function cacheTtlMs(): number {
  const n = Number(process.env.CHUD_CHAIN_BALANCE_CACHE_MS);
  if (Number.isFinite(n) && n >= 60_000 && n <= 86_400_000 * 7) return Math.floor(n);
  return 3_600_000;
}

function maxHeliusPages(): number {
  const n = Number(process.env.CHUD_CHAIN_BALANCE_PAGES);
  if (Number.isFinite(n) && n >= 1 && n <= 500) return Math.floor(n);
  return 30;
}

function fallbackMaxTx(): number {
  const n = Number(process.env.CHUD_FALLBACK_CHAIN_TXS);
  if (Number.isFinite(n) && n >= 0 && n <= 2000) return Math.floor(n);
  return 750;
}

function resolveWalletBase58(): string | null {
  const kp = loadKeypair();
  if (kp) return kp.publicKey.toBase58();
  const pub = process.env.CHUD_WALLET_PUBLIC?.trim();
  return pub || null;
}

function rpcUrl(): string | null {
  const u = process.env.SOLANA_RPC_URL?.trim();
  return u || null;
}

function shouldTryHeliusGtfa(url: string): boolean {
  if (process.env.CHUD_USE_HELIUS_GTFA === "1") return true;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.includes("helius") || h.includes("helius-rpc");
  } catch {
    return false;
  }
}

function accountKeyStrings(keys: unknown[] | undefined): string[] {
  if (!keys || !Array.isArray(keys)) return [];
  return keys.map((k) => {
    if (typeof k === "string") return k;
    if (k && typeof k === "object" && "pubkey" in k) return String((k as { pubkey: string }).pubkey);
    return "";
  });
}

interface GtfaRow {
  blockTime?: number | null;
  transaction?: unknown;
  meta?: { err?: unknown; postBalances?: number[] };
}

function messageAccountKeys(transaction: unknown): unknown[] {
  if (!transaction || typeof transaction !== "object") return [];
  const t = transaction as Record<string, unknown>;
  const msg = t.message;
  if (!msg || typeof msg !== "object") return [];
  const m = msg as Record<string, unknown>;
  if (Array.isArray(m.accountKeys)) return m.accountKeys;
  if (Array.isArray(m.staticAccountKeys)) return m.staticAccountKeys;
  return [];
}

function extractPostSol(row: GtfaRow, wallet: string): number | null {
  if (row.meta?.err != null) return null;
  const keys = accountKeyStrings(messageAccountKeys(row.transaction));
  const idx = keys.findIndex((k) => k === wallet);
  const post = row.meta?.postBalances;
  if (idx < 0 || !post || idx >= post.length) return null;
  const lam = post[idx]!;
  if (typeof lam !== "number" || !Number.isFinite(lam)) return null;
  return lam / LAMPORTS_PER_SOL;
}

async function heliusFetchAllPages(
  url: string,
  wallet: string,
  maxPages: number
): Promise<BalanceHistoryPoint[]> {
  const out: BalanceHistoryPoint[] = [];
  let paginationToken: string | null | undefined = undefined;
  for (let page = 0; page < maxPages; page++) {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTransactionsForAddress",
      params: [
        wallet,
        {
          transactionDetails: "full",
          sort: "asc",
          limit: 100,
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
          commitment: "finalized",
          ...(paginationToken ? { paginationToken } : {}),
        },
      ],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      error?: { message?: string };
      result?: { data?: GtfaRow[]; paginationToken?: string | null };
    };
    if (json.error) {
      throw new Error(json.error.message || "getTransactionsForAddress error");
    }
    const data = json.result?.data ?? [];
    for (const row of data) {
      const bt = row.blockTime;
      if (bt == null || !Number.isFinite(bt)) continue;
      const sol = extractPostSol(row, wallet);
      if (sol == null || !Number.isFinite(sol)) continue;
      out.push({ timestamp: new Date(bt * 1000).toISOString(), balanceSol: sol });
    }
    paginationToken = json.result?.paginationToken ?? null;
    if (!paginationToken || data.length === 0) break;
  }
  return out;
}

async function rpcGetTransactionParsed(url: string, sig: string): Promise<GtfaRow | null> {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTransaction",
    params: [
      sig,
      {
        encoding: "jsonParsed",
        maxSupportedTransactionVersion: 0,
        commitment: "finalized",
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { result?: { blockTime?: number | null; transaction?: unknown; meta?: GtfaRow["meta"] } | null };
  const r = json.result;
  if (!r?.meta) return null;
  return {
    blockTime: r.blockTime,
    transaction: r.transaction,
    meta: r.meta,
  };
}

async function standardRpcFallback(
  url: string,
  wallet: string,
  maxTx: number
): Promise<BalanceHistoryPoint[]> {
  if (maxTx <= 0) return [];
  const conn = new Connection(url);
  const { PublicKey } = await import("@solana/web3.js");
  const pubkey = new PublicKey(wallet);
  const sigs: { signature: string; blockTime?: number | null }[] = [];
  let before: string | undefined;
  while (sigs.length < maxTx) {
    const batch = await conn.getSignaturesForAddress(pubkey, { before, limit: 1000 }, "finalized");
    if (batch.length === 0) break;
    for (const s of batch) {
      sigs.push({ signature: s.signature, blockTime: s.blockTime });
    }
    before = batch[batch.length - 1]?.signature;
    if (batch.length < 1000) break;
  }
  const oldestFirst = sigs.slice(-maxTx).reverse();
  const out: BalanceHistoryPoint[] = [];
  const concurrency = 5;
  for (let i = 0; i < oldestFirst.length; i += concurrency) {
    const chunk = oldestFirst.slice(i, i + concurrency);
    const rows = await Promise.all(chunk.map((c) => rpcGetTransactionParsed(url, c.signature)));
    for (let j = 0; j < chunk.length; j++) {
      const row = rows[j];
      const c = chunk[j]!;
      if (!row) continue;
      const bt = row.blockTime ?? c.blockTime;
      if (bt == null || !Number.isFinite(bt)) continue;
      const sol = extractPostSol(row, wallet);
      if (sol == null || !Number.isFinite(sol)) continue;
      out.push({ timestamp: new Date(bt * 1000).toISOString(), balanceSol: sol });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return out;
}

function readCache(): CacheFile | null {
  const p = cachePath();
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as CacheFile;
    if (!Array.isArray(raw.points)) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(points: BalanceHistoryPoint[]): void {
  const payload: CacheFile = { points, savedAt: new Date().toISOString() };
  writeFileSync(cachePath(), JSON.stringify(payload), "utf-8");
}

/**
 * Many balance samples from on-chain tx history (Helius gTFA when available).
 * Cached ~1h by default. Safe to call from chart route.
 */
export async function getWalletBalanceHistoryPointsCached(): Promise<BalanceHistoryPoint[]> {
  if (process.env.CHUD_CHAIN_BALANCE_DISABLE === "1") return [];

  const cached = readCache();
  if (cached?.savedAt && process.env.CHUD_CHAIN_BALANCE_IGNORE_CACHE !== "1") {
    const age = Date.now() - Date.parse(cached.savedAt);
    if (Number.isFinite(age) && age >= 0 && age < cacheTtlMs()) {
      return cached.points;
    }
  }

  const wallet = resolveWalletBase58();
  const url = rpcUrl();
  if (!wallet || !url) {
    writeCache([]);
    return [];
  }

  let points: BalanceHistoryPoint[] = [];
  try {
    if (shouldTryHeliusGtfa(url)) {
      try {
        points = await heliusFetchAllPages(url, wallet, maxHeliusPages());
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/paid plans|upgrade|not available/i.test(msg)) throw e;
        console.warn("[Chud] Helius gTFA unavailable, using standard RPC history:", msg.slice(0, 80));
      }
    }
    if (points.length < 2) {
      const fromStd = await standardRpcFallback(url, wallet, fallbackMaxTx());
      if (fromStd.length > points.length) points = fromStd;
    }
  } catch {
    if (cached?.points?.length) return cached.points;
    points = [];
  }

  points.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  writeCache(points);
  return points;
}
