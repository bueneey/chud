/**
 * Agent API: used by the backend when Lobbi (running on OpenClaw) drives trading.
 * One position at a time. Agent calls getCandidates → choose → buy(mint) → later sell().
 */
import { config } from "dotenv";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const envPath = [join(root, ".env"), join(process.cwd(), ".env")].find((p) => existsSync(p));
if (envPath) config({ path: envPath });

import type { CandidateCoin } from "./types.js";
import { loadFilters, getLobbiOwnTokenMint } from "./config.js";
import { discoverCandidates } from "./discovery.js";
import { executeBuy, executeSell, recordOpenBuy, getWalletBalanceSol } from "./trade.js";
import {
  getState,
  getOpenTrade,
  getRecentMints,
  clearStaleOpenTrades,
  updateOpenTradeToSold,
  forceCloseOpenTrade,
  appendLog,
} from "./storage.js";
import { emitBought, emitSold, emitIdle } from "./state.js";
import { postChudTweetBuy, postChudTweetSell } from "./x-post.js";
import { getTokenPriceUsd, getTokenMcapUsd, getTokenStats } from "./price.js";
import { planHold } from "./analysis.js";
import { getHolderStats, hasBirdeyeApiKey } from "./birdeye.js";

export interface AgentPosition {
  state: ReturnType<typeof getState>;
  openTrade: ReturnType<typeof getOpenTrade>;
}

/** Unrealized PnL for open position (agent uses this to decide when to sell). */
export interface PositionQuote {
  currentPriceUsd: number | null;
  unrealizedPnlPercent: number | null;
  unrealizedPnlSol: number | null;
  buyPriceUsd: number | null;
  holdSeconds: number;
}

export interface BuyParams {
  mint: string;
  symbol: string;
  name: string;
  reason?: string;
  amountSol?: number;
}

export async function getCandidates(): Promise<CandidateCoin[]> {
  const filters = loadFilters();
  const recent = new Set(getRecentMints(10));
  const ownTokenMint = getLobbiOwnTokenMint();
  if (ownTokenMint) recent.add(ownTokenMint);
  const open = getOpenTrade();
  if (open?.mint) recent.add(open.mint);
  const candidates = await discoverCandidates(filters, { excludeMints: recent, poolSize: 12 });
  if (!hasBirdeyeApiKey() || candidates.length === 0) return candidates;
  const enriched = await Promise.all(
    candidates.slice(0, 6).map(async (c) => {
      const stats = await getHolderStats(c.mint);
      return {
        ...c,
        holderInfo: stats
          ? `${stats.holderCount} holders, top10=${stats.top10PercentOfSupply.toFixed(0)}%${stats.isGoodHolders ? " (good)" : " (concentrated)"}`
          : undefined,
      };
    })
  );
  return [...enriched, ...candidates.slice(6)];
}

export function getPosition(): AgentPosition {
  return { state: getState(), openTrade: getOpenTrade() };
}

const SOL_USD = 76.6;

/** Position + current price / unrealized PnL so the agent can decide when to take profit. */
export async function getPositionWithQuote(): Promise<AgentPosition & { quote?: PositionQuote }> {
  const pos = getPosition();
  const open = pos.openTrade;
  if (!open || !open.buyTokenAmount || open.buyTokenAmount <= 0) return pos;
  const buyTimestamp = open.buyTimestamp ? new Date(open.buyTimestamp).getTime() : Date.now();
  const holdSeconds = Math.round((Date.now() - buyTimestamp) / 1000);
  /** Recorded token amount is often a rough placeholder; absurd values make PnL meaningless. */
  if (open.buyTokenAmount > 1e11) {
    const currentPriceUsd = await getTokenPriceUsd(open.mint);
    return {
      ...pos,
      quote: {
        currentPriceUsd: currentPriceUsd && currentPriceUsd > 0 ? currentPriceUsd : null,
        unrealizedPnlPercent: null,
        unrealizedPnlSol: null,
        buyPriceUsd: null,
        holdSeconds,
      },
    };
  }
  const currentPriceUsd = await getTokenPriceUsd(open.mint);
  if (currentPriceUsd == null || currentPriceUsd <= 0) {
    return { ...pos, quote: { currentPriceUsd: null, unrealizedPnlPercent: null, unrealizedPnlSol: null, buyPriceUsd: null, holdSeconds } };
  }
  const currentValueUsd = open.buyTokenAmount * currentPriceUsd;
  const buyValueUsd = open.buySol * SOL_USD;
  const sellValueSol = currentValueUsd / SOL_USD;
  const unrealizedPnlSol = sellValueSol - open.buySol;
  const unrealizedPnlPercent = buyValueUsd > 0 ? ((currentValueUsd - buyValueUsd) / buyValueUsd) * 100 : (unrealizedPnlSol / open.buySol) * 100;
  const buyPriceUsd = buyValueUsd > 0 && open.buyTokenAmount > 0 ? buyValueUsd / open.buyTokenAmount : currentPriceUsd;
  if (
    !Number.isFinite(unrealizedPnlPercent) ||
    !Number.isFinite(unrealizedPnlSol) ||
    Math.abs(unrealizedPnlPercent) > 50000 ||
    Math.abs(unrealizedPnlSol) > 200 ||
    (buyPriceUsd > 0 && buyPriceUsd < 1e-10)
  ) {
    return {
      ...pos,
      quote: {
        currentPriceUsd,
        unrealizedPnlPercent: null,
        unrealizedPnlSol: null,
        buyPriceUsd: null,
        holdSeconds,
      },
    };
  }
  return {
    ...pos,
    quote: {
      currentPriceUsd,
      unrealizedPnlPercent,
      unrealizedPnlSol,
      buyPriceUsd,
      holdSeconds,
    },
  };
}

/** Close the recorded position without calling PumpPortal (stuck sell / graduated / bad state). */
export async function forceClosePosition(params: {
  reason: string;
}): Promise<{ ok: true; symbol: string; mint: string } | { ok: false; error: string }> {
  const r = forceCloseOpenTrade(params.reason.trim() || "force close");
  if (!r.ok) return r;
  emitIdle();
  appendLog({
    type: "skip",
    message: `Force-closed ${r.symbol} (no chain sell)`,
    symbol: r.symbol,
    reason: params.reason,
  });
  return r;
}

export async function buy(params: BuyParams): Promise<{ ok: true; symbol: string; tx?: string } | { ok: false; error: string }> {
  const open = getOpenTrade();
  if (open) {
    return { ok: false, error: `Already in position: ${open.symbol}. Sell first.` };
  }
  const ownTokenMint = getLobbiOwnTokenMint();
  if (ownTokenMint && params.mint === ownTokenMint) {
    return { ok: false, error: "Cannot buy this token." };
  }
  const filters = loadFilters();
  const requested = params.amountSol ?? 0.1;
  let amountSol = Math.min(requested, filters.maxPositionSol);
  const reserve = Math.max(0.005, Number(process.env.CHUD_WALLET_RESERVE_SOL ?? "0.018"));
  const balance = await getWalletBalanceSol();
  if (balance != null) {
    const spendable = Math.max(0, balance - reserve);
    amountSol = Math.min(amountSol, spendable);
  }
  if (amountSol < 0.001) {
    return {
      ok: false,
      error: `Not enough SOL after fee reserve (~${reserve} SOL). balance≈${balance?.toFixed(4) ?? "?"} — fund wallet, lower amountSol, or set CHUD_WALLET_RESERVE_SOL lower (risk: failed tx from rent/fees).`,
    };
  }
  if (balance != null && amountSol + 1e-9 < Math.min(requested, filters.maxPositionSol)) {
    console.log(
      `[Chud/Agent] Buy size clamped to wallet: requested ${requested} SOL → using ${amountSol.toFixed(4)} SOL (balance ${balance.toFixed(4)}, reserve ${reserve})`
    );
  }
  const candidate: CandidateCoin = {
    mint: params.mint,
    symbol: params.symbol,
    name: params.name,
    reason: params.reason ?? "Chud",
    mcapUsd: undefined,
    volumeUsd: undefined,
  };
  try {
    clearStaleOpenTrades();
    const { tokenAmount, tx: txBuy } = await executeBuy(candidate, amountSol, filters);
    const buyTimestamp = new Date().toISOString();
    const mcapUsd = await getTokenMcapUsd(candidate.mint).catch(() => undefined);
    const holderStats = hasBirdeyeApiKey() ? await getHolderStats(candidate.mint) : null;
    const plan = planHold(candidate, filters, holderStats ?? undefined);
    const why = (params.reason ?? "agent") + " | hold: " + plan.reason;
    recordOpenBuy(candidate.symbol, candidate.name, candidate.mint, why, amountSol, tokenAmount, buyTimestamp, txBuy, mcapUsd ?? undefined);
    emitBought(
      candidate.mint,
      candidate.symbol,
      txBuy,
      mcapUsd ?? undefined,
      holderStats?.holderCount,
      why
    );
    postChudTweetBuy(candidate.symbol, amountSol, params.reason);
    return { ok: true, symbol: candidate.symbol, tx: txBuy };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function sell(params?: { reason?: string }): Promise<
  { ok: true; symbol: string; pnlSol: number; tx?: string } | { ok: false; error: string }
> {
  const open = getOpenTrade();
  if (!open) {
    return { ok: false, error: "No open position to sell." };
  }
  const ownTokenMint = getLobbiOwnTokenMint();
  if (ownTokenMint && open.mint === ownTokenMint) {
    return { ok: false, error: "Cannot sell this position." };
  }
  const filters = loadFilters();
  try {
    const balBefore = await getWalletBalanceSol();
    const res = await executeSell(open.mint, open.buyTokenAmount, filters);
    let solReceived = res.solReceived;
    if (solReceived <= 0 && balBefore != null) {
      await new Promise((r) => setTimeout(r, 5000));
      const balAfter = await getWalletBalanceSol();
      if (balAfter != null) solReceived = Math.max(0, balAfter - balBefore);
    }
    const sellTimestamp = new Date().toISOString();
    const statsAtSell = await getTokenStats(open.mint);
    const mcapAtSellUsd = statsAtSell?.mcapUsd ?? (await getTokenMcapUsd(open.mint).catch(() => undefined));
    const volumeAtSellUsd = statsAtSell?.volumeUsd;
    if (solReceived <= 0 && open.mcapUsd != null && open.mcapUsd > 0 && mcapAtSellUsd != null && mcapAtSellUsd > 0) {
      solReceived = open.buySol * (mcapAtSellUsd / open.mcapUsd);
    }
    if (solReceived <= 0) solReceived = open.buySol * 0.95;
    const whySold = params?.reason?.trim() || "Agent exit";
    updateOpenTradeToSold(solReceived, open.buyTokenAmount, sellTimestamp, res.tx, mcapAtSellUsd ?? undefined, whySold, volumeAtSellUsd);
    const pnlSol = solReceived - open.buySol;
    emitSold(open.mint, open.symbol, pnlSol, res.tx);
    postChudTweetSell(open.symbol, pnlSol, whySold);
    return { ok: true, symbol: open.symbol, pnlSol, tx: res.tx };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export { getWalletBalanceSol, getWalletBalanceWithError } from "./trade.js";
