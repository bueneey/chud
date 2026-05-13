/**
 * Persisted wallet balance samples (same DATA_DIR as clawdbot via getDataDir).
 * Merged into /api/balance/chart so the graph fills even with few closed trades.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "clawdbot/config";

const FILE = "balance-snapshots.json";
/** After this many samples, older history is folded to one point per UTC day so we keep all-time shape. */
const MAX_POINTS = 24_000;
const RECENT_RAW_KEEP = 4000;
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

function utcDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Older than RECENT_RAW_KEEP → one closing sample per UTC day; keeps long-range chart data. */
export function compactBalanceSnapshotHistory(points: BalanceSnapshotPoint[]): BalanceSnapshotPoint[] {
  if (points.length <= MAX_POINTS) return points;
  const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const recent = sorted.slice(-RECENT_RAW_KEEP);
  const old = sorted.slice(0, -RECENT_RAW_KEEP);
  const byDay = new Map<string, BalanceSnapshotPoint>();
  for (const p of old) {
    const key = utcDayKey(p.timestamp);
    const cur = byDay.get(key);
    if (!cur || Date.parse(p.timestamp) >= Date.parse(cur.timestamp)) byDay.set(key, p);
  }
  let archived = Array.from(byDay.values()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const cap = MAX_POINTS;
  if (archived.length + recent.length > cap) {
    const maxArch = Math.max(0, cap - recent.length);
    archived = maxArch < archived.length ? archived.slice(-maxArch) : archived;
  }
  return [...archived, ...recent];
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
  const trimmed = pts.length > MAX_POINTS ? compactBalanceSnapshotHistory(pts) : pts;
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
