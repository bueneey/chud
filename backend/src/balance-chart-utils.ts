import type { BalanceSnapshotPoint } from "./balance-snapshots.js";

/** Optional manual chart anchor (ISO). Prefer on-chain discovery via getWalletFirstOnChainActivityMs. */
export function parseWalletChartAnchorOverrideMs(): number | null {
  const raw = process.env.CHUD_WALLET_CREATED_AT?.trim();
  if (!raw) return null;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

/** Earliest plausible chart start: manual override, else min(RPC wallet birth, local data). */
export function resolveChartOriginMs(opts: {
  manualOverrideMs: number | null;
  chainBirthMs: number | null;
  inferredMs: number | null;
}): number | null {
  if (opts.manualOverrideMs != null) return opts.manualOverrideMs;
  const parts = [opts.chainBirthMs, opts.inferredMs].filter(
    (x): x is number => x != null && Number.isFinite(x)
  );
  if (parts.length === 0) return null;
  return Math.min(...parts);
}

/** Earliest timestamp we can infer from trades (first buy) or snapshots. */
export function earliestDataMs(
  trades: { buyTimestamp: string }[],
  snapshots: BalanceSnapshotPoint[]
): number | null {
  const times: number[] = [];
  for (const t of trades) {
    const u = Date.parse(t.buyTimestamp);
    if (Number.isFinite(u)) times.push(u);
  }
  for (const s of snapshots) {
    const u = Date.parse(s.timestamp);
    if (Number.isFinite(u)) times.push(u);
  }
  if (times.length === 0) return null;
  return Math.min(...times);
}

/** Prepend a point at chart origin so the x-axis starts at wallet birth / earliest data. */
export function ensureChartOrigin(
  sortedPoints: BalanceSnapshotPoint[],
  originMs: number | null,
  startBalanceSol: number
): BalanceSnapshotPoint[] {
  if (originMs == null || sortedPoints.length === 0) return sortedPoints;
  const firstT = Date.parse(sortedPoints[0]!.timestamp);
  if (!Number.isFinite(firstT) || firstT <= originMs) return sortedPoints;
  return [{ timestamp: new Date(originMs).toISOString(), balanceSol: startBalanceSol }, ...sortedPoints];
}

function dedupeAdjacentSameTime(points: BalanceSnapshotPoint[]): BalanceSnapshotPoint[] {
  const out: BalanceSnapshotPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.timestamp === p.timestamp) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/**
 * Cap display points using **time** (not array index) so uneven samples map correctly.
 */
export function downsampleChartByTime(
  sortedPoints: BalanceSnapshotPoint[],
  maxPoints: number
): BalanceSnapshotPoint[] {
  if (sortedPoints.length <= maxPoints) return sortedPoints;
  const t0 = Date.parse(sortedPoints[0]!.timestamp);
  const t1 = Date.parse(sortedPoints[sortedPoints.length - 1]!.timestamp);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return sortedPoints;
  const span = Math.max(t1 - t0, 1);
  const buckets = maxPoints;
  const out: BalanceSnapshotPoint[] = [];
  let j = 0;
  for (let b = 0; b < buckets; b++) {
    const end = b === buckets - 1 ? t1 + 1 : t0 + (span * (b + 1)) / (buckets - 1);
    while (j < sortedPoints.length && Date.parse(sortedPoints[j]!.timestamp) <= end) {
      j++;
    }
    const idx = Math.max(0, j - 1);
    out.push(sortedPoints[idx]!);
  }
  return dedupeAdjacentSameTime(out);
}
