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
 * Time buckets: keep first/last sample in each bucket plus the points with **min** and **max** balance
 * so wipes, refills, and spikes survive downsampling (plain averages would flatten them).
 */
export function downsampleChartByTime(
  sortedPoints: BalanceSnapshotPoint[],
  maxOut: number
): BalanceSnapshotPoint[] {
  if (sortedPoints.length <= maxOut) return sortedPoints;
  const t0 = Date.parse(sortedPoints[0]!.timestamp);
  const t1 = Date.parse(sortedPoints[sortedPoints.length - 1]!.timestamp);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return sortedPoints;
  const span = Math.max(t1 - t0, 1);
  const maxPerBucket = 4;
  const nBuckets = Math.max(1, Math.floor(maxOut / maxPerBucket));
  const out: BalanceSnapshotPoint[] = [];
  let idx = 0;
  for (let b = 0; b < nBuckets; b++) {
    const bt0 = t0 + (span * b) / nBuckets;
    const bt1 = b === nBuckets - 1 ? t1 + 1 : t0 + (span * (b + 1)) / nBuckets;
    while (idx < sortedPoints.length && Date.parse(sortedPoints[idx]!.timestamp) < bt0) idx++;
    const startIdx = idx;
    let k = idx;
    while (k < sortedPoints.length && Date.parse(sortedPoints[k]!.timestamp) < bt1) k++;
    const bucket = sortedPoints.slice(startIdx, k);
    idx = k;
    if (bucket.length === 0) continue;
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;
    let minP = first;
    let maxP = first;
    for (const p of bucket) {
      if (p.balanceSol < minP.balanceSol) minP = p;
      if (p.balanceSol > maxP.balanceSol) maxP = p;
    }
    const pick = new Map<string, BalanceSnapshotPoint>();
    for (const p of [first, last, minP, maxP]) pick.set(p.timestamp, p);
    const chunk = Array.from(pick.values()).sort((a, c) => Date.parse(a.timestamp) - Date.parse(c.timestamp));
    for (const p of chunk) out.push(p);
  }
  return dedupeAdjacentSameTime(out);
}
