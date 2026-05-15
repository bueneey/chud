/**
 * Lifetime wallet PnL from on-chain native SOL transfers in (+ initial bankroll).
 * Cached under DATA_DIR/wallet-pnl-tracker.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";
import { getDataDir } from "./config.js";
import { loadKeypair } from "./wallet.js";
import { getWalletBalanceSol } from "./trade.js";
import type { BalanceHistoryPoint } from "./wallet-balance-history.js";

const TRACKER_FILE = "wallet-pnl-tracker.json";
const CACHE_MS = 3_600_000;

export interface WalletPnlTrackerData {
  lifetimeNetDepositSol: number;
  totalPnlSol: number;
  balanceSol: number;
  nativeInflowSol: number;
  nativeOutflowSol: number;
  initialBankrollSol: number;
  source: "chain" | "chart" | "override";
  updatedAt: string;
}

function trackerPath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, TRACKER_FILE);
}

function readTracker(): WalletPnlTrackerData | null {
  const p = trackerPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as WalletPnlTrackerData;
  } catch {
    return null;
  }
}

function writeTracker(data: WalletPnlTrackerData): void {
  writeFileSync(trackerPath(), JSON.stringify(data, null, 2), "utf-8");
}

function parseOverride(): number | null {
  const raw = process.env.CHUD_LIFETIME_NET_DEPOSIT_SOL?.trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function pubkeyBase58(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if ("pubkey" in v) return String((v as { pubkey: unknown }).pubkey);
    if ("toString" in v && typeof (v as { toString: () => string }).toString === "function") {
      const s = (v as { toString: () => string }).toString();
      if (s.length >= 32 && s.length <= 50) return s;
    }
  }
  return null;
}

function resolveWalletForScan(): string | null {
  const kp = loadKeypair();
  if (kp) return kp.publicKey.toBase58();
  const pub = process.env.CHUD_WALLET_PUBLIC?.trim();
  return pub || null;
}

function parseTransferLamports(ix: unknown, wallet: string): { inSol: number; outSol: number } {
  let inSol = 0;
  let outSol = 0;
  if (!ix || typeof ix !== "object") return { inSol, outSol };
  const row = ix as { program?: string; parsed?: { type?: string; info?: Record<string, unknown> } };
  if (row.program !== "system" || row.parsed?.type !== "transfer") return { inSol, outSol };
  const info = row.parsed.info;
  if (!info) return { inSol, outSol };
  const lam = Number(info.lamports);
  if (!Number.isFinite(lam) || lam <= 0) return { inSol, outSol };
  const sol = lam / 1e9;
  const dest = pubkeyBase58(info.destination);
  const src = pubkeyBase58(info.source);
  if (dest === wallet) inSol += sol;
  if (src === wallet) outSol += sol;
  return { inSol, outSol };
}

function accumulateTransfersFromTx(tx: unknown, wallet: string): { inSol: number; outSol: number } {
  let inSol = 0;
  let outSol = 0;
  if (!tx || typeof tx !== "object") return { inSol, outSol };
  const t = tx as {
    transaction?: { message?: { instructions?: unknown[] } };
    meta?: { innerInstructions?: { instructions?: unknown[] }[] };
  };
  const top = t.transaction?.message?.instructions ?? [];
  for (const ix of top) {
    const p = parseTransferLamports(ix, wallet);
    inSol += p.inSol;
    outSol += p.outSol;
  }
  for (const inner of t.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions ?? []) {
      const p = parseTransferLamports(ix, wallet);
      inSol += p.inSol;
      outSol += p.outSol;
    }
  }
  return { inSol, outSol };
}

async function scanNativeTransfers(
  url: string,
  wallet: string,
  maxTx: number
): Promise<{ inflowSol: number; outflowSol: number }> {
  const kp = loadKeypair();
  if (!kp) return { inflowSol: 0, outflowSol: 0 };
  const conn = new Connection(url);
  const sigs: string[] = [];
  let before: string | undefined;
  while (sigs.length < maxTx) {
    const batch = await conn.getSignaturesForAddress(kp.publicKey, { before, limit: 1000 }, "finalized");
    if (batch.length === 0) break;
    for (const s of batch) sigs.push(s.signature);
    before = batch[batch.length - 1]?.signature;
    if (batch.length < 1000) break;
  }
  const use = sigs.slice(-maxTx);
  let inflowSol = 0;
  let outflowSol = 0;
  const concurrency = 3;
  for (let i = 0; i < use.length; i += concurrency) {
    const chunk = use.slice(i, i + concurrency);
    const txs = await Promise.all(
      chunk.map((sig) =>
        conn.getParsedTransaction(sig, {
          maxSupportedTransactionVersion: 0,
          commitment: "finalized",
        })
      )
    );
    for (const tx of txs) {
      if (!tx) continue;
      const p = accumulateTransfersFromTx(tx, wallet);
      inflowSol += p.inSol;
      outflowSol += p.outSol;
    }
    await new Promise((r) => setTimeout(r, 180));
  }
  return { inflowSol, outflowSol };
}

function initialBankrollSol(): number {
  const raw = process.env.CHUD_INITIAL_BANKROLL_SOL?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 1;
}

/** First funded balance on chain history (seed not always a visible transfer). */
function seedFromFirstBalance(firstBalanceSol: number | null): number {
  if (firstBalanceSol == null || firstBalanceSol < 0.02) return 0;
  return Math.min(firstBalanceSol, initialBankrollSol());
}

function isBadPnlCache(c: WalletPnlTrackerData): boolean {
  return c.nativeInflowSol < 0.05 && c.lifetimeNetDepositSol <= initialBankrollSol() + 0.05;
}

/**
 * Sum starting bankroll + ~1 SOL refills after blow-ups (dust → wire in).
 * Matches on-chain wallet history better than counting swap proceeds as deposits.
 */
export function estimateLifetimeNetDepositFromChart(points: BalanceHistoryPoint[]): number {
  const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (sorted.length === 0) return initialBankrollSol();
  const first = sorted[0]!.balanceSol;
  let deposits =
    first >= 0.5 && first <= 2.5 ? first : Math.min(Math.max(first, 0), initialBankrollSol());
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.balanceSol;
    const curr = sorted[i]!.balanceSol;
    const delta = curr - prev;
    // ~1 SOL external refill after blow-up (exclude swap PnL spikes from dust)
    if (prev <= 0.1 && delta >= 0.7 && delta <= 1.55) deposits += delta;
  }
  return Math.max(deposits, initialBankrollSol(), 0.01);
}

export async function getWalletPnlTracker(opts?: {
  firstBalanceSol?: number | null;
  chartPoints?: BalanceHistoryPoint[];
  ignoreCache?: boolean;
}): Promise<WalletPnlTrackerData> {
  const override = parseOverride();
  const balanceSol = (await getWalletBalanceSol()) ?? 0;

  if (override != null) {
    const data: WalletPnlTrackerData = {
      lifetimeNetDepositSol: override,
      totalPnlSol: balanceSol - override,
      balanceSol,
      nativeInflowSol: 0,
      nativeOutflowSol: 0,
      initialBankrollSol: 0,
      source: "override",
      updatedAt: new Date().toISOString(),
    };
    writeTracker(data);
    return data;
  }

  const cached = readTracker();
  const chartPoints = opts?.chartPoints ?? [];
  const cacheLooksValid = cached != null && !isBadPnlCache(cached);
  if (
    cached &&
    cacheLooksValid &&
    !opts?.ignoreCache &&
    process.env.CHUD_PNL_TRACKER_IGNORE_CACHE !== "1" &&
    chartPoints.length < 2
  ) {
    const age = Date.now() - Date.parse(cached.updatedAt);
    if (Number.isFinite(age) && age >= 0 && age < CACHE_MS) {
      return {
        ...cached,
        balanceSol,
        totalPnlSol: balanceSol - cached.lifetimeNetDepositSol,
      };
    }
  }

  const url = process.env.SOLANA_RPC_URL?.trim();
  const wallet = resolveWalletForScan();
  let nativeInflowSol = 0;
  let nativeOutflowSol = 0;

  if (url && wallet) {
    const maxTx = Number(process.env.CHUD_PNL_TRACKER_TXS) || 750;
    try {
      const scanned = await scanNativeTransfers(url, wallet, maxTx);
      nativeInflowSol = scanned.inflowSol;
      nativeOutflowSol = scanned.outflowSol;
    } catch {
      if (cached && cached.nativeInflowSol > 0.05) {
        nativeInflowSol = cached.nativeInflowSol;
        nativeOutflowSol = cached.nativeOutflowSol;
      }
    }
  }

  if (nativeInflowSol < 0.05 && cached && cached.nativeInflowSol > 0.05) {
    nativeInflowSol = cached.nativeInflowSol;
    nativeOutflowSol = cached.nativeOutflowSol;
  }

  const seed = seedFromFirstBalance(opts?.firstBalanceSol ?? null);

  let lifetimeNetDepositSol: number;
  let source: WalletPnlTrackerData["source"] = "chain";

  if (chartPoints.length >= 2) {
    lifetimeNetDepositSol = estimateLifetimeNetDepositFromChart(chartPoints);
    source = "chart";
  } else {
    const transferNet = Math.max(nativeInflowSol - nativeOutflowSol, 0) + seed;
    lifetimeNetDepositSol = Math.max(transferNet, seed, 0.01);
    if (nativeInflowSol < 0.05) {
      lifetimeNetDepositSol = Math.max(seed, initialBankrollSol());
    }
  }

  const data: WalletPnlTrackerData = {
    lifetimeNetDepositSol,
    totalPnlSol: balanceSol - lifetimeNetDepositSol,
    balanceSol,
    nativeInflowSol,
    nativeOutflowSol,
    initialBankrollSol: seed || initialBankrollSol(),
    source,
    updatedAt: new Date().toISOString(),
  };
  writeTracker(data);
  return data;
}

/** Always derive PnL from live balance minus lifetime deposits (single source of truth). */
export function totalPnlFromBalance(balanceSol: number, lifetimeNetDepositSol: number): number {
  return balanceSol - lifetimeNetDepositSol;
}
