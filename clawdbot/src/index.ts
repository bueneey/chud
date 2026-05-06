import { config } from "dotenv";
import { existsSync } from "fs";
import { join } from "path";
const envPath = [
  join(process.cwd(), ".env"),
  join(process.cwd(), "..", ".env"),
  join(process.cwd(), "..", "..", ".env"),
].find((p) => existsSync(p));
if (envPath) config({ path: envPath });
import { loadFilters, getDataDir, DEMO_MODE, getChudOwnTokenMint } from "./config.js";
import {
  setState,
  getOpenTrade,
  getRecentMints,
  getRecentClosedTradesSummary,
  tryAcquireCycleLock,
  releaseCycleLock,
  clearStaleOpenTrades,
  updateOpenTradeToSold,
  appendLog,
} from "./storage.js";
import { discoverCandidates } from "./discovery.js";
import { loadKeypair } from "./wallet.js";
import { executeBuy, executeSell, recordOpenBuy, getWalletBalanceSol } from "./trade.js";
import { planHold, buildNarrativeWhy } from "./analysis.js";
import { getTokenPriceUsd, getTokenMcapUsd, getTokenStats, getBondingCurveSolReserves } from "./price.js";
import { getHolderStats, hasBirdeyeApiKey } from "./birdeye.js";
import {
  emitIdle,
  emitThinking,
  emitChoosing,
  emitBought,
  emitSold,
} from "./state.js";
import { getPositionWithQuote } from "./agent-api.js";
import { askChudShouldSell, askChudPickCandidate } from "./llm.js";
import { anyChudLlmConfigured } from "./llm-provider-order.js";
import { postChudTweetBuy, postChudTweetSell, isXPostingConfigured, describeXPosting } from "./x-post.js";
import { maybeStartThoughtPosting } from "./thought-post.js";
import type { CandidateCoin, HoldPlan, ChudState } from "./types.js";

/**
 * How often to ask Claude “sell or hold?” while you have a position open.
 * Default 2 minutes so idle bags do not burn credits (15s × 240/hr adds up fast).
 * Set CHUD_HOLD_POLL_MS lower only if you want faster reactions.
 */
const HOLD_POLL_MS = Math.max(30_000, Number(process.env.CHUD_HOLD_POLL_MS || "120000"));
/** If >0, force a sell after this many minutes regardless of LLM. Default 0 = never (Chud only exits when the model says SELL). */
const FORCE_SELL_AFTER_MIN = Math.max(0, Number(process.env.CHUD_FORCE_SELL_AFTER_MINUTES || "0"));
let _loggedNoWallet = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Hold position; Chud (via LLM) decides when to sell from narrative + tape + recent trades. */
async function holdAndSell(
  mint: string,
  symbol: string,
  buySol: number,
  tokenAmount: number,
  filters: ReturnType<typeof loadFilters>,
  _plan: HoldPlan
): Promise<void> {
  const hasLlm = anyChudLlmConfigured();
  if (!hasLlm) {
    console.warn(
      "[Chud] No LLM configured—cannot decide when to sell. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_MODEL; or use CHUD_FORCE_SELL_AFTER_MINUTES."
    );
  }
  if (!hasLlm && FORCE_SELL_AFTER_MIN <= 0) {
    console.warn(
      "[Chud] No LLM keys and CHUD_FORCE_SELL_AFTER_MINUTES is 0 — this position will never auto-exit. Add keys or set e.g. CHUD_FORCE_SELL_AFTER_MINUTES=120."
    );
  }
  const ownTokenMint = getChudOwnTokenMint();

  while (true) {
    await sleep(HOLD_POLL_MS);
    const open = getOpenTrade();
    if (!open || open.mint !== mint) return;

    if (ownTokenMint && open.mint === ownTokenMint) continue;

    const buyTimestamp = open.buyTimestamp ? new Date(open.buyTimestamp).getTime() : Date.now();
    const holdSeconds = Math.round((Date.now() - buyTimestamp) / 1000);

    let shouldSell: boolean;
    let reason: string | undefined;

    if (FORCE_SELL_AFTER_MIN > 0 && holdSeconds >= FORCE_SELL_AFTER_MIN * 60) {
      console.log(`[Chud] Force sell after ${FORCE_SELL_AFTER_MIN}m (CHUD_FORCE_SELL_AFTER_MINUTES).`);
      shouldSell = true;
      reason = `Force exit after ${FORCE_SELL_AFTER_MIN}m (timer)—held ${Math.floor(holdSeconds / 60)}m`;
      appendLog({
        type: "sell",
        symbol,
        message: `Force sell ${FORCE_SELL_AFTER_MIN}m`,
        reason,
        holdMin: Math.floor(holdSeconds / 60),
      });
    } else if (!hasLlm) {
      continue;
    } else {
      let quote: Awaited<ReturnType<typeof getPositionWithQuote>>["quote"];
      try {
        const pos = await getPositionWithQuote();
        quote = pos.quote;
      } catch (e) {
        console.warn("[Chud] getPositionWithQuote failed:", e);
        continue;
      }
      if (!quote) continue;

      const memory = getRecentClosedTradesSummary(8);
      const result = await askChudShouldSell(symbol, open.why ?? "", quote, memory);
      shouldSell = result.shouldSell;
      reason = result.reason;
      const pnlPct = quote?.unrealizedPnlPercent ?? 0;
      const holdMin = Math.floor(holdSeconds / 60);
      if (shouldSell) {
        appendLog({ type: "sell", symbol, message: `SELL: ${reason ?? "LLM decided"}`, reason, pnlPercent: pnlPct, holdMin });
      } else if (holdSeconds % 30 < 5) {
        appendLog({ type: "hold", symbol, message: `HOLD — PnL ${pnlPct.toFixed(1)}%, held ${holdMin}m`, pnlPercent: pnlPct, holdMin });
      }
    }
    if (!shouldSell) continue;

    console.log("[Chud] Selling:", reason ?? "LLM decided");
    const balBefore = await getWalletBalanceSol();
    const res = await executeSell(mint, tokenAmount, filters);
    let solReceived = res.solReceived;
    const sellTimestamp = new Date().toISOString();
    if (solReceived <= 0 && balBefore != null) {
      await sleep(5000);
      const balAfter = await getWalletBalanceSol();
      if (balAfter != null) solReceived = Math.max(0, balAfter - balBefore);
    }
    const statsAtSell = await getTokenStats(mint);
    const mcapAtSellUsd = statsAtSell?.mcapUsd ?? (await getTokenMcapUsd(mint));
    const volumeAtSellUsd = statsAtSell?.volumeUsd;
    if (solReceived <= 0 && open.mcapUsd != null && open.mcapUsd > 0 && mcapAtSellUsd != null && mcapAtSellUsd > 0) {
      solReceived = buySol * (mcapAtSellUsd / open.mcapUsd);
    }
    if (solReceived <= 0) solReceived = buySol * 0.95;
    const whySold = reason ?? "Chud exit";
    updateOpenTradeToSold(solReceived, tokenAmount, sellTimestamp, res.tx, mcapAtSellUsd ?? undefined, whySold, volumeAtSellUsd);
    emitSold(mint, symbol, solReceived - buySol, res.tx);
    postChudTweetSell(symbol, solReceived - buySol, whySold);
    return;
  }
}

const LOCK_RETRY_MS = 30_000; // 30s backoff when another instance holds lock

async function runCycle(): Promise<void> {
  if (!tryAcquireCycleLock()) {
    console.log("[Clawdbot] Another instance holds the lock or a cycle is running. Skipping. Retrying in 30s.");
    await sleep(LOCK_RETRY_MS);
    return;
  }
  try {
    await runCycleBody();
  } finally {
    releaseCycleLock();
  }
}

async function runCycleBody(): Promise<void> {
  const filters = loadFilters();

  if (!loadKeypair()) {
    if (!_loggedNoWallet) {
      console.log("[Clawdbot] No WALLET_PRIVATE_KEY in .env—idle. Add wallet to enable trading.");
      appendLog({ type: "idle", message: "No wallet—idle. Add WALLET_PRIVATE_KEY to enable trading." });
      _loggedNoWallet = true;
    }
    setState({ kind: "idle", at: new Date().toISOString() });
    emitIdle();
    return;
  }

  const open = getOpenTrade();
  if (open) {
    appendLog({ type: "idle", symbol: open.symbol, message: `Resuming: holding $${open.symbol}` });
    setState({
      kind: "bought",
      at: new Date().toISOString(),
      message: `Bought ${open.symbol}`,
      chosenMint: open.mint,
      chosenSymbol: open.symbol,
      chosenMcapUsd: open.mcapUsd,
      chosenReason: open.why,
    } as ChudState);
    const resumePlan: HoldPlan = {
      holdMinMs: filters.holdMinSeconds * 1000,
      holdMaxMs: filters.holdMaxSeconds * 1000,
      takeProfitPercent: filters.takeProfitPercent,
      stopLossPercent: filters.stopLossPercent,
      reason: "resumed",
    };
    await holdAndSell(open.mint, open.symbol, open.buySol, open.buyTokenAmount, filters, resumePlan);
    appendLog({ type: "idle", message: `Sold. Waiting ${((filters.loopDelayMs ?? 3 * 60 * 1000) / 1000)}s before next scan.` });
    emitIdle();
    const loopDelay = filters.loopDelayMs ?? 3 * 60 * 1000;
    if (loopDelay > 0) {
      console.log(`[Clawdbot] Waiting ${loopDelay / 1000}s before next buy.`);
      await sleep(loopDelay);
    }
    return;
  }

  emitIdle();
  await sleep(2000);

  emitThinking();
  appendLog({ type: "thinking", message: "Scanning pump.fun for candidates..." });
  await sleep(3000);

  const recentMints = new Set(getRecentMints(10));
  const ownTokenMint = getChudOwnTokenMint();
  if (ownTokenMint) recentMints.add(ownTokenMint);
  const openMint = getOpenTrade()?.mint;
  if (openMint) recentMints.add(openMint);
  const candidates = await discoverCandidates(filters, {
    excludeMints: recentMints,
    poolSize: 12,
  });
  if (candidates.length === 0) {
    appendLog({ type: "skip", message: "No candidates found (filters: ≤1h old, mcap $10k–$31.4k, min vol $12k). Retrying next cycle." });
    emitIdle();
    return;
  }

  appendLog({
    type: "candidates",
    message: `Found ${candidates.length} candidates: ${candidates.slice(0, 5).map((c) => c.symbol).join(", ")}${candidates.length > 5 ? "…" : ""}`,
  });
  emitChoosing(candidates);
  await sleep(1000);

  const hasLlmPick = anyChudLlmConfigured();
  let chosen: CandidateCoin;
  let pickNarrative = "";
  if (hasLlmPick) {
    const pick = await askChudPickCandidate(candidates);
    if (pick && pick.index >= 0 && pick.index < candidates.length) {
      chosen = candidates[pick.index]!;
      pickNarrative = pick.narrative;
      appendLog({
        type: "chosen",
        symbol: chosen.symbol,
        message: `Chud picked $${chosen.symbol} — ${pickNarrative.slice(0, 240)}`,
      });
    } else {
      chosen = pickOne(candidates);
      appendLog({
        type: "chosen",
        symbol: chosen.symbol,
        message: `Chose $${chosen.symbol} — ${chosen.reason} (LLM pick failed, random)`,
      });
    }
  } else {
    chosen = pickOne(candidates);
    appendLog({
      type: "chosen",
      symbol: chosen.symbol,
      message: `Chose $${chosen.symbol} — ${chosen.reason} (no LLM keys—random)`,
    });
  }
  if (chosen.mint.startsWith("DemoMint") || (ownTokenMint && chosen.mint === ownTokenMint)) {
    emitIdle();
    return;
  }

  const maxAgeMs = filters.maxAgeMinutes * 60 * 1000;
  if (chosen.mcapUsd != null && (chosen.mcapUsd < filters.minMcapUsd || chosen.mcapUsd > (filters.maxMcapUsd ?? 31400))) {
    console.warn("[Clawdbot] Chosen coin mcap out of range, skipping");
    emitIdle();
    return;
  }
  if (chosen.volumeUsd != null && chosen.volumeUsd < filters.minVolumeUsd) {
    console.warn("[Clawdbot] Chosen coin volume below min, skipping");
    emitIdle();
    return;
  }
  if (chosen.pairCreatedAt != null && Date.now() - chosen.pairCreatedAt > maxAgeMs) {
    console.warn("[Clawdbot] Chosen coin too old, skipping");
    emitIdle();
    return;
  }
  const minFeesSol = filters.minGlobalFeesPaidSol ?? 0.8;
  if (chosen.mint.endsWith("pump")) {
    const curveSol = await getBondingCurveSolReserves(chosen.mint);
    if (curveSol != null && curveSol < minFeesSol) {
      console.warn("[Clawdbot] Chosen coin bonding curve SOL", curveSol.toFixed(2), "< min", minFeesSol, "SOL, skipping");
      emitIdle();
      return;
    }
    if (curveSol == null && !DEMO_MODE) {
      console.warn("[Clawdbot] Could not fetch bonding curve for", chosen.symbol, ", skipping (require min 0.8 SOL fees)");
      emitIdle();
      return;
    }
  }
  if (chosen.globalFeesPaidSol != null && chosen.globalFeesPaidSol < minFeesSol) {
    console.warn("[Clawdbot] Chosen coin below min global fees paid (0.8 SOL), skipping");
    emitIdle();
    return;
  }

  const holderStats = hasBirdeyeApiKey() ? await getHolderStats(chosen.mint) : null;
  const plan = planHold(chosen, filters, holderStats);

  const minBuy = filters.minPositionSol ?? 0.1;
  const maxBuy = filters.maxPositionSol ?? 0.25;
  const buySol = minBuy + Math.random() * (maxBuy - minBuy);
  const { tokenAmount, tx: txBuy } = await executeBuy(chosen, buySol, filters);
  const buyTimestamp = new Date().toISOString();

  const statsAtBuy = await getTokenStats(chosen.mint);
  const mcapAtBuyUsd = statsAtBuy?.mcapUsd ?? chosen.mcapUsd ?? (await getTokenMcapUsd(chosen.mint));
  const volumeAtBuyUsd = statsAtBuy?.volumeUsd ?? chosen.volumeUsd;
  const ageMinutesAtBuy =
    chosen.pairCreatedAt != null
      ? Math.round((Date.now() - chosen.pairCreatedAt) / 60000)
      : undefined;
  const baseWhy = buildNarrativeWhy(chosen, plan, holderStats, ageMinutesAtBuy);
  const narrativeWhy = pickNarrative ? `${pickNarrative}\n—\n${baseWhy}` : baseWhy;
  appendLog({
    type: "bought",
    symbol: chosen.symbol,
    message: `Bought $${chosen.symbol} — ${narrativeWhy.slice(0, 120)}…`,
  });

  clearStaleOpenTrades();
  recordOpenBuy(
    chosen.symbol,
    chosen.name,
    chosen.mint,
    narrativeWhy,
    buySol,
    tokenAmount,
    buyTimestamp,
    txBuy,
    mcapAtBuyUsd ?? undefined,
    volumeAtBuyUsd,
    ageMinutesAtBuy
  );
  const holderCount = holderStats?.holderCount;
  const buyReason = narrativeWhy;
  emitBought(chosen.mint, chosen.symbol, txBuy, mcapAtBuyUsd ?? chosen.mcapUsd ?? undefined, holderCount, buyReason);
  postChudTweetBuy(chosen.symbol, buySol);
  await sleep(2000);

  await holdAndSell(chosen.mint, chosen.symbol, buySol, tokenAmount, filters, plan);
  appendLog({ type: "idle", message: `Sold. Waiting ${((filters.loopDelayMs ?? 3 * 60 * 1000) / 1000)}s before next scan.` });
  emitIdle();
  const loopDelay = filters.loopDelayMs ?? 3 * 60 * 1000;
  if (loopDelay > 0) {
    await sleep(loopDelay);
  }
}

/** Start the trading loop. Can be called by backend to run bot in same process. */
export async function startTradingLoop(): Promise<never> {
  releaseCycleLock();
  console.log("[Clawdbot] Data dir:", getDataDir());
  console.log("[Clawdbot] Demo mode:", DEMO_MODE);
  const kp = loadKeypair();
  console.log("[Clawdbot] Wallet:", kp ? kp.publicKey.toBase58().slice(0, 8) + "…" : "NOT SET");
  console.log("[Clawdbot] Filters:", JSON.stringify(loadFilters(), null, 2));
  const f = loadFilters();
  console.log(
    "[Clawdbot] One position at a time. Loop delay:",
    (f.loopDelayMs ?? 180000) / 1000 + "s. Min hold:",
    f.holdMinSeconds + "s."
  );
  if (isXPostingConfigured()) {
    console.log("[Chud/X] Posting:", describeXPosting());
  }
  console.log(
    `[Chud/LLM] hold poll every ${HOLD_POLL_MS / 1000}s · force sell after ${FORCE_SELL_AFTER_MIN || "∞"} min (CHUD_FORCE_SELL_AFTER_MINUTES)`
  );
  if (process.env.ANTHROPIC_API_KEY?.trim() && HOLD_POLL_MS < 120_000) {
    console.warn(
      "[Chud/LLM] Anthropic + hold poll under 2 min → API cost scales quickly. Try CHUD_HOLD_POLL_MS=300000 (5m) or higher."
    );
  }

  const open = getOpenTrade();
  if (open) {
    appendLog({ type: "idle", symbol: open.symbol, message: `Resuming: holding $${open.symbol}` });
    setState({
      kind: "bought",
      at: new Date().toISOString(),
      message: `Bought ${open.symbol}`,
      chosenMint: open.mint,
      chosenSymbol: open.symbol,
      chosenMcapUsd: open.mcapUsd,
      chosenReason: open.why,
    } as ChudState);
    console.log("[Clawdbot] Resuming open position:", open.symbol);
  } else {
    setState({ kind: "idle", at: new Date().toISOString() } as ChudState);
  }

  while (true) {
    try {
      await runCycle();
    } catch (e) {
      console.error("[Clawdbot] Cycle error:", e);
      emitIdle();
      releaseCycleLock();
    }
  }
}

const openclawOnly =
  process.env.CHUD_OPENCLAW_ONLY === "1" ||
  process.env.CHUD_OPENCLAW_ONLY === "true" ||
  process.env.CHUD_AUTONOMOUS_LOOP === "0" ||
  process.env.CHUD_AUTONOMOUS_LOOP === "false";

if (openclawOnly) {
  console.log(
    "[Clawdbot] Autonomous loop is OFF (CHUD_OPENCLAW_ONLY or CHUD_AUTONOMOUS_LOOP=false). " +
      "Trades + X posts on buy/sell happen when something calls the agent API (e.g. OpenClaw + chud_trading skill)."
  );
} else {
  void startTradingLoop();
}

maybeStartThoughtPosting();
