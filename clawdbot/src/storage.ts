import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { TradeRecord, ChudState } from "./types.js";
import { getDataDir } from "./config.js";

function dataPath(file: string): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, file);
}

const TRADES_FILE = "trades.json";
const STATE_FILE = "state.json";
const LOGS_FILE = "logs.json";
const CYCLE_LOCK_FILE = ".cycle-lock";
const MAX_LOGS = 300;
const LOCK_MAX_AGE_MS = 15 * 60 * 1000;

let tradesCache: TradeRecord[] = [];
let stateCache: ChudState | null = null;

function loadTrades(): TradeRecord[] {
  const p = dataPath(TRADES_FILE);
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as TradeRecord[];
    return dedupeOpenTrades(raw);
  } catch {
    return [];
  }
}

/** Remove duplicate open buys (same mint+txBuy). Keeps first occurrence. */
function dedupeOpenTrades(trades: TradeRecord[]): TradeRecord[] {
  const seen = new Set<string>();
  const out: TradeRecord[] = [];
  for (const t of trades) {
    if (!t.sellTimestamp || t.sellTimestamp === "") {
      const key = `${t.mint}:${t.txBuy ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(t);
  }
  if (out.length < trades.length) {
    writeFileSync(dataPath(TRADES_FILE), JSON.stringify(out, null, 2));
    tradesCache = out;
  }
  return out;
}

function loadState(): ChudState | null {
  const p = dataPath(STATE_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

export function getTrades(): TradeRecord[] {
  tradesCache = loadTrades();
  return tradesCache;
}

/** Mints we bought in the last N closed trades (to avoid re-buying same coin). */
export function getRecentMints(lastN: number): string[] {
  const trades = loadTrades();
  const closed = trades.filter((t) => t.sellTimestamp && t.sellTimestamp !== "");
  return closed.slice(0, lastN).map((t) => t.mint);
}

/** Closed trades for LLM “memory” — newest first. */
export function getRecentClosedTradesSummary(maxLines: number): string {
  const trades = loadTrades();
  const closed = trades.filter((t) => t.sellTimestamp && t.sellTimestamp !== "");
  const lines = closed.slice(0, maxLines).map((t) => {
    const pnl = Number.isFinite(t.pnlSol) ? (t.pnlSol >= 0 ? "+" : "") + t.pnlSol.toFixed(3) : "?";
    const note = (t.whySold ?? "").slice(0, 140).replace(/\s+/g, " ").trim();
    return `- $${t.symbol}: ${pnl} SOL${note ? ` — ${note}` : ""}`;
  });
  return lines.length ? lines.join("\n") : "(no closed trades yet—this is the prequel)";
}

/** Returns true if we already have a buy record for this mint+tx (prevents duplicate entries). */
export function hasDuplicateBuy(mint: string, txBuy?: string): boolean {
  const all = loadTrades();
  if (!txBuy) return all.some((x) => x.mint === mint && !x.sellTimestamp);
  return all.some((x) => x.mint === mint && x.txBuy === txBuy);
}

export function appendTrade(t: TradeRecord): void {
  if (t.txBuy && hasDuplicateBuy(t.mint, t.txBuy)) {
    console.warn("[Clawdbot] Skipping duplicate buy record:", t.symbol, t.txBuy.slice(0, 8) + "...");
    return;
  }
  const all = loadTrades();
  all.unshift(t);
  writeFileSync(dataPath(TRADES_FILE), JSON.stringify(all, null, 2));
  tradesCache = all;
}

/** Remove any stale open trades (should never have one when recording a new buy). Call before recording a new buy. */
export function clearStaleOpenTrades(): void {
  const all = loadTrades();
  const open = all.find((t) => !t.sellTimestamp || t.sellTimestamp === "");
  if (open) {
    console.error("[Clawdbot] BUG: clearStaleOpenTrades called with open position:", open.symbol, "- refusing to clear to avoid trade disappearing");
    return;
  }
  const closedOnly = all.filter((t) => t.sellTimestamp && t.sellTimestamp !== "");
  if (closedOnly.length === all.length) return;
  writeFileSync(dataPath(TRADES_FILE), JSON.stringify(closedOnly, null, 2));
  tradesCache = closedOnly;
}

/** After partial sell: shrink bag, mark initials taken, accumulate partial SOL. */
export function updateOpenTradeAfterPartialSell(solReceived: number, tokensSold: number, tx?: string): void {
  const all = loadTrades();
  const idx = all.findIndex((t) => !t.sellTimestamp || t.sellTimestamp === "");
  if (idx === -1) return;
  const t = all[idx]!;
  t.initialsTaken = true;
  t.partialSellSol = (t.partialSellSol ?? 0) + solReceived;
  t.buyTokenAmount = Math.max(0, t.buyTokenAmount - tokensSold);
  if (tx) t.txSell = tx;
  writeFileSync(dataPath(TRADES_FILE), JSON.stringify(all, null, 2));
  tradesCache = all;
}

/** Update the current open position (first trade with no sell) with sell data. Only one open at a time. */
export function updateOpenTradeToSold(
  sellSol: number,
  sellTokenAmount: number,
  sellTimestamp: string,
  txSell?: string,
  mcapAtSellUsd?: number,
  whySold?: string,
  volumeAtSellUsd?: number
): void {
  const all = loadTrades();
  const idx = all.findIndex((t) => !t.sellTimestamp || t.sellTimestamp === "");
  if (idx === -1) return;
  const t = all[idx]!;
  t.sellSol = sellSol;
  t.sellTokenAmount = sellTokenAmount;
  t.sellTimestamp = sellTimestamp;
  t.txSell = txSell;
  t.mcapAtSellUsd = mcapAtSellUsd;
  if (whySold != null) t.whySold = whySold;
  if (volumeAtSellUsd != null) t.volumeAtSellUsd = volumeAtSellUsd;
  t.holdSeconds = Math.round((new Date(sellTimestamp).getTime() - new Date(t.buyTimestamp).getTime()) / 1000);
  if (t.ageMinutesAtBuy != null) t.ageMinutesAtSell = t.ageMinutesAtBuy + Math.round(t.holdSeconds / 60);
  const partial = t.partialSellSol ?? 0;
  t.pnlSol = sellSol + partial - t.buySol;
  writeFileSync(dataPath(TRADES_FILE), JSON.stringify(all, null, 2));
  tradesCache = all;
}

/** Current open position (trade with no sell yet). Only one at a time. */
export function getOpenTrade(): TradeRecord | null {
  const all = loadTrades();
  const t = all.find((x) => !x.sellTimestamp || x.sellTimestamp === "");
  return t ?? null;
}

/**
 * Mark the open trade closed **without** an on-chain sell (PumpPortal 400, graduated token, etc.).
 * PnL recorded as 0 SOL (sellSol = buySol). Wallet may still hold tokens — user must handle on-chain if needed.
 */
export function forceCloseOpenTrade(whySold: string): { ok: true; symbol: string; mint: string } | { ok: false; error: string } {
  const open = getOpenTrade();
  if (!open) return { ok: false, error: "No open trade" };
  const ts = new Date().toISOString();
  updateOpenTradeToSold(
    open.buySol,
    open.buyTokenAmount,
    ts,
    "force_close",
    open.mcapUsd,
    whySold,
    open.volumeAtBuyUsd
  );
  return { ok: true, symbol: open.symbol, mint: open.mint };
}

export function getState(): ChudState | null {
  stateCache = loadState();
  return stateCache;
}

export function setState(s: ChudState): void {
  writeFileSync(dataPath(STATE_FILE), JSON.stringify(s, null, 2));
  stateCache = s;
}

/** Try to acquire lock so only one cycle runs at a time (avoid same coin bought twice by two processes). */
export function tryAcquireCycleLock(): boolean {
  const p = dataPath(CYCLE_LOCK_FILE);
  if (existsSync(p)) {
    try {
      const data = JSON.parse(readFileSync(p, "utf-8")) as { at: string };
      const age = Date.now() - new Date(data.at).getTime();
      if (age < LOCK_MAX_AGE_MS) return false;
    } catch {
      /* stale or invalid, remove and take lock */
    }
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
  try {
    writeFileSync(p, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function releaseCycleLock(): void {
  try {
    unlinkSync(dataPath(CYCLE_LOCK_FILE));
  } catch {
    /* ignore */
  }
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: "idle" | "thinking" | "candidates" | "chosen" | "bought" | "hold" | "sell" | "skip" | "error";
  message: string;
  symbol?: string;
  pnlPercent?: number;
  holdMin?: number;
  reason?: string;
}

function genLogId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function appendLog(entry: Omit<LogEntry, "id" | "timestamp">): void {
  const full: LogEntry = {
    ...entry,
    id: genLogId(),
    timestamp: new Date().toISOString(),
  };
  const p = dataPath(LOGS_FILE);
  let logs: LogEntry[] = [];
  if (existsSync(p)) {
    try {
      logs = JSON.parse(readFileSync(p, "utf-8"));
    } catch {
      /* ignore */
    }
  }
  logs.unshift(full);
  if (logs.length > MAX_LOGS) logs = logs.slice(0, MAX_LOGS);
  writeFileSync(p, JSON.stringify(logs, null, 2));
}
