import type { CandidateCoin, Filters } from "./types.js";
import { getTokenList, hasBirdeyeApiKey } from "./birdeye.js";

const DEXSCREENER = "https://api.dexscreener.com/latest/dex";
const FETCH_TIMEOUT_MS = 12_000;

interface DexPair {
  chainId: string;
  dexId: string;
  url?: string;
  baseToken: { address: string; symbol: string; name: string };
  quoteToken: { address: string; symbol: string };
  volume?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
}

function isPumpToken(addr: string): boolean {
  return addr.length >= 32 && (addr.endsWith("pump") || addr.toLowerCase().includes("pump"));
}

function parsePairs(data: { pairs?: DexPair[] }): DexPair[] {
  return data?.pairs ?? [];
}
function fetchWithTimeout(url: string): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
}

function collectFromPairs(
  pairs: DexPair[],
  filters: { minVol: number; minMcap: number; maxMcap: number; maxAgeMs: number },
  pumpOnly: boolean,
  seen: Set<string>,
  candidates: CandidateCoin[],
  now: number,
  maxCount: number,
  exclude?: Set<string>,
  allowMissingAge?: boolean
): void {
  for (const p of pairs) {
    if (p.chainId !== "solana") continue;
    const mint = p.baseToken.address;
    if (seen.has(mint) || exclude?.has(mint)) continue;
    const onPump =
      p.dexId === "pump" ||
      p.dexId === "pumpswap" ||
      isPumpToken(mint) ||
      (p.url ?? "").toLowerCase().includes("pump");
    if (pumpOnly && !onPump) continue;
    const vol = p.volume?.h24 ?? 0;
    const mcap = p.fdv ?? p.marketCap ?? p.liquidity?.usd ?? 0;
    const created = p.pairCreatedAt ?? 0;
    const ageOk = created >= now - filters.maxAgeMs || (allowMissingAge && created === 0);
    const mcapOk = mcap <= filters.maxMcap && mcap >= filters.minMcap;
    if (vol >= filters.minVol && mcapOk && ageOk) {
      seen.add(mint);
      const ageMin = Math.round((now - created) / 60000);
      const liq = p.liquidity?.usd ?? 0;
      candidates.push({
        mint,
        symbol: p.baseToken.symbol || "???",
        name: p.baseToken.name || p.baseToken.symbol || "Unknown",
        reason: candidateBlurb(ageMin, onPump),
        volumeUsd: vol,
        mcapUsd: mcap,
        pairCreatedAt: created,
        liquidityUsd: liq,
        pairUrl: p.url,
      });
      if (candidates.length >= maxCount) return;
    }
  }
}

const DISCOVERY_POOL_SIZE = 12;

/** User-facing blurb only — no vol/mcap (Chud voice, not spreadsheet). */
function candidateBlurb(ageMin?: number, isPump?: boolean): string {
  const parts: string[] = [];
  if (ageMin != null && ageMin >= 0) parts.push(`${ageMin}m on chain`);
  if (isPump) parts.push("pump lane");
  return parts.length ? parts.join(" · ") : "on the board";
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface DiscoverOptions {
  /** Exclude these mints (e.g. recently bought) so we don't keep buying the same coin. */
  excludeMints?: Set<string>;
  /** How many to collect before shuffling and picking; default 12 for variety. */
  poolSize?: number;
}

export async function discoverCandidates(
  filters: Filters,
  options?: DiscoverOptions
): Promise<CandidateCoin[]> {
  const now = Date.now();
  const poolSize = Math.min(options?.poolSize ?? DISCOVERY_POOL_SIZE, 20);
  const maxCandidates = Math.min(filters.maxCandidates, 10);
  const exclude = options?.excludeMints;
  const seen = new Set<string>();
  const candidates: CandidateCoin[] = [];
  const maxMcap = filters.maxMcapUsd ?? 31400;
  const minMcap = filters.minMcapUsd;
  const minVol = filters.minVolumeUsd;

  const add = (c: CandidateCoin) => {
    if (exclude?.has(c.mint)) return;
    if (seen.has(c.mint)) return;
    seen.add(c.mint);
    candidates.push(c);
  };

  if (hasBirdeyeApiKey()) {
    const birdeyeTokens = await getTokenList({
      sortBy: "v24hUSD",
      sortType: "desc",
      limit: 50,
      minLiquidity: Math.min(1000, minVol),
    });
    for (const t of birdeyeTokens) {
      const mint = t.address;
      const mcap = t.mc ?? 0;
      const vol = t.v24hUSD ?? 0;
      const liq = t.liquidity ?? 0;
      if (mcap < minMcap || mcap > maxMcap || vol < minVol) continue;
      const isPump = mint.length >= 32 && (mint.endsWith("pump") || mint.toLowerCase().includes("pump"));
      add({
        mint,
        symbol: t.symbol || "???",
        name: t.name || t.symbol || "Unknown",
        reason: candidateBlurb(undefined, isPump),
        volumeUsd: vol,
        mcapUsd: mcap,
        liquidityUsd: liq,
      });
      if (candidates.length >= poolSize) break;
    }
  }

  const maxAgeMs = filters.maxAgeMinutes * 60 * 1000;

  const strict = {
    minVol: filters.minVolumeUsd,
    minMcap: filters.minMcapUsd,
    maxMcap,
    maxAgeMs,
  };
  const relaxedVolMcapOnly = {
    minVol: Math.min(5000, filters.minVolumeUsd),
    minMcap: Math.min(5000, filters.minMcapUsd),
    maxMcap,
    maxAgeMs,
  };
  const relaxedAll = {
    minVol: Math.min(3000, filters.minVolumeUsd),
    minMcap: Math.min(3000, filters.minMcapUsd),
    maxMcap,
    maxAgeMs,
  };

  const queries = ["pumpswap", "pump", "pumpfun", "memecoin", "sol", "pepe", "doge", "wojak", "based", "trending"];

  for (const q of queries) {
    try {
      const res = await fetchWithTimeout(`${DEXSCREENER}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) continue;
      const data = (await res.json()) as { pairs?: DexPair[] };
      const pairs = parsePairs(data);
      collectFromPairs(pairs, strict, true, seen, candidates, now, poolSize, exclude);
      if (candidates.length >= poolSize) break;
    } catch (e) {
      console.warn("[discovery] query failed:", q, e);
    }
  }

  if (candidates.length === 0) {
    for (const q of queries) {
      try {
        const res = await fetchWithTimeout(`${DEXSCREENER}/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { pairs?: DexPair[] };
        collectFromPairs(parsePairs(data), relaxedVolMcapOnly, true, seen, candidates, now, poolSize, exclude);
        if (candidates.length >= poolSize) break;
      } catch {
        /* ignore */
      }
    }
  }

  if (candidates.length === 0) {
    for (const q of ["pump", "solana", "trending"]) {
      try {
        const res = await fetchWithTimeout(`${DEXSCREENER}/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { pairs?: DexPair[] };
        collectFromPairs(parsePairs(data), relaxedAll, true, seen, candidates, now, poolSize, exclude);
        if (candidates.length >= poolSize) break;
      } catch {
        /* ignore */
      }
    }
  }

  if (candidates.length === 0) {
    for (const q of ["solana", "trending"]) {
      try {
        const res = await fetchWithTimeout(`${DEXSCREENER}/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { pairs?: DexPair[] };
        collectFromPairs(parsePairs(data), relaxedAll, false, seen, candidates, now, poolSize, exclude);
        if (candidates.length >= poolSize) break;
      } catch {
        /* ignore */
      }
    }
  }
  if (candidates.length === 0) {
    for (const q of ["pump", "pumpswap", "solana"]) {
      try {
        const res = await fetchWithTimeout(`${DEXSCREENER}/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) continue;
        const data = (await res.json()) as { pairs?: DexPair[] };
        collectFromPairs(parsePairs(data), relaxedAll, true, seen, candidates, now, poolSize, exclude, true);
        if (candidates.length >= poolSize) break;
      } catch {
        /* ignore */
      }
    }
  }

  const maxAgeMsEnforce = filters.maxAgeMinutes * 60 * 1000;
  const nowMs = Date.now();
  const minFees = filters.minGlobalFeesPaidSol ?? 0;
  const realOnly = candidates
    .filter((c) => !c.mint.startsWith("DemoMint"))
    .filter((c) => {
      if (c.mcapUsd != null && (c.mcapUsd < filters.minMcapUsd || c.mcapUsd > maxMcap)) return false;
      if (c.volumeUsd != null && c.volumeUsd < filters.minVolumeUsd) return false;
      if (c.globalFeesPaidSol != null && c.globalFeesPaidSol < minFees) return false;
      if (c.pairCreatedAt == null) return false;
      if (nowMs - c.pairCreatedAt > maxAgeMsEnforce) return false;
      return true;
    });
  if (realOnly.length > 0) {
    return shuffle(realOnly).slice(0, maxCandidates);
  }
  const fallback = candidates
    .filter((c) => !c.mint.startsWith("DemoMint"))
    .filter((c) => {
      if (c.mcapUsd != null && (c.mcapUsd < filters.minMcapUsd || c.mcapUsd > maxMcap)) return false;
      if (c.volumeUsd != null && c.volumeUsd < filters.minVolumeUsd) return false;
      if (c.globalFeesPaidSol != null && c.globalFeesPaidSol < minFees) return false;
      if (c.pairCreatedAt != null && c.pairCreatedAt > 0 && nowMs - c.pairCreatedAt > maxAgeMsEnforce) return false;
      return true;
    });
  if (fallback.length > 0) {
    console.warn("[discovery] No coins with age ≤1h; using", fallback.length, "candidates that pass mcap/vol only.");
    return shuffle(fallback).slice(0, maxCandidates);
  }
  return [];
}
