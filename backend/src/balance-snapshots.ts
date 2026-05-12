/**
 * Persisted wallet balance samples (same DATA_DIR as clawdbot via getDataDir).
 * Merged into /api/balance/chart so the graph fills even with few closed trades.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "clawdbot/config";

const FILE = "balance-snapshots.json";
const MAX_POINTS = 12000;
const DEFAULT_MIN_MS = 50_000;

export interface BalanceSnapshotPoint {
  timestamp: string;
  balanceSol: number;
}

interface FileShape {
  points: BalanceSnapshotPoint[];
}

let lastAppendMs = 0;

function filePath(): string {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, FILE);
}

export function readBalanceSnapshots(): BalanceSnapshotPoint[] {
  const p = filePath();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as FileShape;
    return Array.isArray(raw.points) ? raw.points : [];
  } catch {
    return [];
  }
}

function minIntervalMs(): number {
  const n = Number(process.env.CHUD_BALANCE_SNAPSHOT_MS);
  if (Number.isFinite(n) && n >= 15_000 && n <= 3_600_000) return Math.floor(n);
  return DEFAULT_MIN_MS;
}

/** Throttled append of current chain balance. */
export function maybeAppendBalanceSnapshot(balanceSol: number): void {
  if (!Number.isFinite(balanceSol) || balanceSol < 0) return;
  const now = Date.now();
  const gap = minIntervalMs();
  if (now - lastAppendMs < gap) return;
  lastAppendMs = now;

  const pts = readBalanceSnapshots();
  pts.push({ timestamp: new Date().toISOString(), balanceSol: balanceSol });
  const trimmed = pts.length > MAX_POINTS ? pts.slice(-MAX_POINTS) : pts;
  writeFileSync(filePath(), JSON.stringify({ points: trimmed }, null, 0), "utf-8");
}

export function mergeBalanceChartPoints(
  tradePoints: BalanceSnapshotPoint[],
  snapshotPoints: BalanceSnapshotPoint[]
): BalanceSnapshotPoint[] {
  const all = [...tradePoints, ...snapshotPoints];
  all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return all;
}
