import type { BalanceSnapshotPoint } from "./balance-snapshots.js";

/** Optional manual chart anchor (ISO). */
export function parseWalletChartAnchorOverrideMs(): number | null {
  const raw = process.env.CHUD_WALLET_CREATED_AT?.trim();
  if (!raw) return null;
  const n = Date.parse(raw);
  return Number.isFinite(n) ? n : null;
}

export function resolveChartPrependOriginMs(opts: {
  manualOverrideMs: number | null;
  inferredMs: number | null;
}): number | null {
  if (opts.manualOverrideMs != null) return opts.manualOverrideMs;
  return opts.inferredMs;
}

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

/** Same UTC second: keep last sample (newer wins). */
export function dedupeSameSecondKeepLast(points: BalanceSnapshotPoint[]): BalanceSnapshotPoint[] {
  if (points.length < 2) return points;
  const sorted = [...points].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const out: BalanceSnapshotPoint[] = [];
  const secKey = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  for (const p of sorted) {
    const k = secKey(p.timestamp);
    const prev = out[out.length - 1];
    if (prev && secKey(prev.timestamp) === k) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

/** Uniform time buckets — one point per bucket (last sample in window) for even x spacing. */
export function uniformTimeSample(
  sortedPoints: BalanceSnapshotPoint[],
  maxOut: number
): BalanceSnapshotPoint[] {
  if (sortedPoints.length <= maxOut) return sortedPoints;
  const t0 = Date.parse(sortedPoints[0]!.timestamp);
  const t1 = Date.parse(sortedPoints[sortedPoints.length - 1]!.timestamp);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return sortedPoints;
  const span = Math.max(t1 - t0, 1);
  const buckets = maxOut;
  const out: BalanceSnapshotPoint[] = [];
  let idx = 0;
  for (let b = 0; b < buckets; b++) {
    const end = b === buckets - 1 ? t1 + 1 : t0 + (span * (b + 1)) / buckets;
    while (idx < sortedPoints.length && Date.parse(sortedPoints[idx]!.timestamp) < end) {
      idx++;
    }
    const pick = sortedPoints[Math.max(0, idx - 1)]!;
    out.push(pick);
  }
  return dedupeAdjacentSameTime(out);
}

/** @deprecated alias */
export function downsampleChartByTime(
  sortedPoints: BalanceSnapshotPoint[],
  maxOut: number
): BalanceSnapshotPoint[] {
  return uniformTimeSample(sortedPoints, maxOut);
}

/** Collapse long flat near-zero runs so blown ports don't stretch the x-axis for days. */
export function collapseNearZeroRuns(
  sortedPoints: BalanceSnapshotPoint[],
  nearZero = 0.025,
  maxZeroSpanMs = 2 * 60 * 60_000
): BalanceSnapshotPoint[] {
  if (sortedPoints.length < 3) return sortedPoints;
  const out: BalanceSnapshotPoint[] = [];
  let i = 0;
  while (i < sortedPoints.length) {
    const p = sortedPoints[i]!;
    if (p.balanceSol >= nearZero) {
      out.push(p);
      i++;
      continue;
    }
    const runStart = i;
    let runEnd = i;
    while (runEnd + 1 < sortedPoints.length && sortedPoints[runEnd + 1]!.balanceSol < nearZero) {
      runEnd++;
    }
    const t0 = Date.parse(sortedPoints[runStart]!.timestamp);
    const t1 = Date.parse(sortedPoints[runEnd]!.timestamp);
    out.push(sortedPoints[runStart]!);
    if (runEnd > runStart && t1 - t0 > maxZeroSpanMs) {
      out.push(sortedPoints[runEnd]!);
    } else {
      for (let j = runStart + 1; j <= runEnd; j++) out.push(sortedPoints[j]!);
    }
    i = runEnd + 1;
  }
  return out;
}

/** Wider time buckets (last sample per bucket) for a smooth, readable chart. */
export function timeBucketChartPoints(
  sortedPoints: BalanceSnapshotPoint[],
  maxBuckets = 72
): BalanceSnapshotPoint[] {
  if (sortedPoints.length <= maxBuckets) return sortedPoints;
  const t0 = Date.parse(sortedPoints[0]!.timestamp);
  const t1 = Date.parse(sortedPoints[sortedPoints.length - 1]!.timestamp);
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return sortedPoints;
  const span = Math.max(t1 - t0, 1);
  const day = 86_400_000;
  let bucketMs = 15 * 60_000;
  if (span > 14 * day) bucketMs = 6 * 60 * 60_000;
  else if (span > 7 * day) bucketMs = 3 * 60 * 60_000;
  else if (span > 2 * day) bucketMs = 60 * 60_000;
  else if (span > 12 * 60 * 60_000) bucketMs = 30 * 60_000;

  const buckets = Math.min(maxBuckets, Math.max(24, Math.ceil(span / bucketMs)));
  const out: BalanceSnapshotPoint[] = [];
  for (let b = 0; b < buckets; b++) {
    const start = t0 + (span * b) / buckets;
    const end = b === buckets - 1 ? t1 + 1 : t0 + (span * (b + 1)) / buckets;
    let pick: BalanceSnapshotPoint | null = null;
    for (const p of sortedPoints) {
      const t = Date.parse(p.timestamp);
      if (t >= start && t < end) pick = p;
    }
    if (pick) out.push(pick);
  }
  if (out.length === 0) return sortedPoints.slice(-maxBuckets);
  const last = sortedPoints[sortedPoints.length - 1]!;
  if (out[out.length - 1]!.timestamp !== last.timestamp) out.push(last);
  return dedupeAdjacentSameTime(out);
}
