import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDataDir } from "clawdbot/config";

function findRoot(): string {
  const d = dirname(fileURLToPath(import.meta.url));
  let root = join(d, "..", "..");
  if (!existsSync(join(root, "data")) && existsSync(join(root, "..", "data"))) {
    root = join(root, "..");
  }
  if (!existsSync(join(root, "config")) && existsSync(join(root, "..", "config"))) {
    root = join(root, "..");
  }
  return root;
}
const root = findRoot();
const TRADES_FILE = "trades.json";
const STATE_FILE = "state.json";
const LOGS_FILE = "logs.json";
const configDir = join(root, "config");

export interface FiltersConfig {
  minVolumeUsd?: number;
  minMcapUsd?: number;
  maxMcapUsd?: number;
  minGlobalFeesPaidSol?: number;
  maxAgeMinutes?: number;
  holdMinSeconds?: number;
  holdMaxSeconds?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
}

function readJson<T>(filename: string, fallback: T): T {
  const p = join(getDataDir(), filename);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function readConfigJson<T>(filename: string, fallback: T): T {
  const p = join(configDir, filename);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

export function getFilters(): FiltersConfig {
  return readConfigJson<FiltersConfig>("filters.json", {});
}

export interface TradeRecord {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  why: string;
  whySold?: string;
  mcapUsd?: number;
  mcapAtSellUsd?: number;
  volumeAtBuyUsd?: number;
  volumeAtSellUsd?: number;
  ageMinutesAtBuy?: number;
  ageMinutesAtSell?: number;
  buySol: number;
  buyTokenAmount: number;
  buyTimestamp: string;
  sellSol: number;
  sellTokenAmount: number;
  sellTimestamp: string;
  holdSeconds: number;
  pnlSol: number;
  txBuy?: string;
  txSell?: string;
}

export interface CandidateCoin {
  mint: string;
  symbol: string;
  name: string;
  reason: string;
  volumeUsd?: number;
  mcapUsd?: number;
  pairCreatedAt?: number;
}

export type ChudStateKind = "idle" | "thinking" | "choosing" | "bought" | "sold";

export interface ChudState {
  kind: ChudStateKind;
  at: string;
  message?: string;
  candidateCoins?: CandidateCoin[];
  chosenMint?: string;
  chosenSymbol?: string;
  lastTx?: string;
  chosenMcapUsd?: number;
  chosenHolderCount?: number;
  chosenReason?: string;
}

export function getTrades(): TradeRecord[] {
  return readJson<TradeRecord[]>(TRADES_FILE, []);
}

export function getState(): ChudState | null {
  return readJson<ChudState | null>(STATE_FILE, null);
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  symbol?: string;
  pnlPercent?: number;
  holdMin?: number;
  reason?: string;
}

export function getLogs(): LogEntry[] {
  return readJson<LogEntry[]>(LOGS_FILE, []);
}
