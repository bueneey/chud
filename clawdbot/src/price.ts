import { getTokenPriceUsdBirdeye, hasBirdeyeApiKey } from "./birdeye.js";

const DEXSCREENER = "https://api.dexscreener.com/latest/dex";
const PUMP_BONDING_API = "https://api.pumpfunapis.com/api/bonding-curve";
const LAMPORTS_PER_SOL = 1e9;

interface Pair {
  baseToken?: { address: string };
  priceUsd?: string;
  priceNative?: string;
  fdv?: number;
  marketCap?: number;
  volume?: { h24?: number };
}

async function getTokenPriceUsdDexScreener(mint: string): Promise<number | null> {
  try {
    const res = await fetch(`${DEXSCREENER}/token-pairs/v1/solana/${mint}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { pairs?: Pair[] };
    const pairs = data?.pairs ?? [];
    const p = pairs[0];
    if (!p?.priceUsd) return null;
    return parseFloat(p.priceUsd);
  } catch {
    return null;
  }
}

/**
 * Fetch current token price in USD. Tries Birdeye first (more accurate) if BIRDEYE_API_KEY is set, else DexScreener.
 */
export async function getTokenPriceUsd(mint: string): Promise<number | null> {
  if (hasBirdeyeApiKey()) {
    const p = await getTokenPriceUsdBirdeye(mint);
    if (p != null && p > 0) return p;
  }
  return getTokenPriceUsdDexScreener(mint);
}

/** Fetch current token mcap (FDV) in USD from DexScreener. */
export async function getTokenMcapUsd(mint: string): Promise<number | null> {
  const s = await getTokenStats(mint);
  return s?.mcapUsd ?? null;
}

/** Fetch mcap and 24h volume from DexScreener (one request). */
export async function getTokenStats(mint: string): Promise<{ mcapUsd: number; volumeUsd: number } | null> {
  try {
    const res = await fetch(`${DEXSCREENER}/token-pairs/v1/solana/${mint}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { pairs?: Pair[] };
    const pairs = data?.pairs ?? [];
    const p = pairs[0];
    if (!p) return null;
    const mcap = p?.fdv ?? p?.marketCap;
    const vol = p?.volume?.h24 ?? 0;
    if (mcap == null) return null;
    const mcapUsd = typeof mcap === "number" ? mcap : parseFloat(String(mcap));
    const volumeUsd = typeof vol === "number" ? vol : parseFloat(String(vol)) || 0;
    return { mcapUsd, volumeUsd };
  } catch {
    return null;
  }
}

const SOL_PRICE_USD_FALLBACK = 91;
const PRICE_CACHE_MS = 45_000;
let cachedSolUsd: { price: number; at: number } | null = null;

export function usdToSolApprox(usd: number): number {
  return usd / getSolPriceUsdSync();
}

export function getSolPriceUsdSync(): number {
  return cachedSolUsd?.price ?? SOL_PRICE_USD_FALLBACK;
}

async function fetchSolFromCoinGecko(): Promise<number | null> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { headers: { accept: "application/json" } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { solana?: { usd?: number } };
  const p = data?.solana?.usd;
  return typeof p === "number" && p > 0 ? p : null;
}

async function fetchSolFromJupiter(): Promise<number | null> {
  const res = await fetch("https://price.jup.ag/v6/price?ids=SOL");
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { SOL?: { price?: number } } };
  const p = data?.data?.SOL?.price;
  return typeof p === "number" && p > 0 ? p : null;
}

/** Live SOL/USD (CoinGecko, then Jupiter), cached ~45s. */
export async function getSolPriceUsd(): Promise<number> {
  if (cachedSolUsd && Date.now() - cachedSolUsd.at < PRICE_CACHE_MS) {
    return cachedSolUsd.price;
  }
  for (const fn of [fetchSolFromCoinGecko, fetchSolFromJupiter]) {
    try {
      const p = await fn();
      if (p != null) {
        cachedSolUsd = { price: p, at: Date.now() };
        return p;
      }
    } catch {
      /* next source */
    }
  }
  return cachedSolUsd?.price ?? SOL_PRICE_USD_FALLBACK;
}

/**
 * Fetch bonding curve real SOL reserves for a pump.fun token (proxy for "global fees paid" / activity).
 * Returns SOL amount or null if not a pump token or API fails.
 */
export async function getBondingCurveSolReserves(mint: string): Promise<number | null> {
  if (!mint || !mint.endsWith("pump")) return null;
  try {
    const res = await fetch(`${PUMP_BONDING_API}/${mint}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { real_sol_reserves?: number; realSolReserves?: number };
    const lamports = data?.real_sol_reserves ?? data?.realSolReserves;
    if (lamports == null) return null;
    return lamports / LAMPORTS_PER_SOL;
  } catch {
    return null;
  }
}
