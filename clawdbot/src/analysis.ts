import type { CandidateCoin, Filters, HoldPlan } from "./types.js";

export interface HolderStats {
  holderCount: number;
  top10PercentOfSupply: number;
  isGoodHolders: boolean;
}

/**
 * Analyse coin (volume, mcap, liquidity, optional holder stats) to decide hold time and take-profit/stop-loss.
 * - High volume/mcap = healthy velocity → hold longer, aim for higher TP.
 * - Good liquidity vs mcap = easier exit → can use tighter SL.
 * - Good holders (many wallets, not concentrated) → longer hold, higher TP.
 * - Small mcap near max = more volatile → shorter max hold, respect SL.
 */
export function planHold(
  coin: CandidateCoin,
  filters: Filters,
  holderStats?: HolderStats | null
): HoldPlan {
  const vol = coin.volumeUsd ?? 0;
  const mcap = coin.mcapUsd ?? 0;
  const liq = coin.liquidityUsd ?? 0;

  const baseMin = filters.holdMinSeconds * 1000;
  const baseMax = filters.holdMaxSeconds * 1000;
  const baseTP = filters.takeProfitPercent;
  const baseSL = filters.stopLossPercent;

  let holdMinMs = baseMin;
  let holdMaxMs = baseMax;
  let takeProfitPercent = baseTP;
  let stopLossPercent = baseSL;
  const reasons: string[] = [];

  if (holderStats) {
    if (holderStats.isGoodHolders) {
      holdMaxMs = Math.min(holdMaxMs * 1.2, 600 * 1000);
      takeProfitPercent = Math.min(takeProfitPercent + 10, 80);
      reasons.push(`good holders (${holderStats.holderCount}, top10 ${holderStats.top10PercentOfSupply.toFixed(0)}%)`);
    } else if (holderStats.holderCount < 10 || holderStats.top10PercentOfSupply > 85) {
      holdMaxMs = Math.min(holdMaxMs, 120 * 1000);
      reasons.push("concentrated holders");
    }
  }

  if (mcap > 0 && vol > 0) {
    const velocity = vol / mcap;
    if (velocity > 0.5) {
      holdMaxMs = Math.min(baseMax * 1.5, 600 * 1000);
      takeProfitPercent = Math.min(baseTP + 20, 80);
      reasons.push("high vol/mcap");
    } else if (velocity < 0.1) {
      holdMaxMs = Math.max(baseMax * 0.6, 60 * 1000);
      stopLossPercent = Math.min(baseSL - 5, -15);
      reasons.push("low velocity");
    }
  }

  if (liq > 0 && mcap > 0) {
    const liqRatio = liq / mcap;
    if (liqRatio > 0.3) {
      reasons.push("good liquidity");
    } else if (liqRatio < 0.1) {
      holdMaxMs = Math.min(holdMaxMs, 120 * 1000);
      reasons.push("thin liquidity");
    }
  }

  const maxMcap = filters.maxMcapUsd ?? 31400;
  if (mcap > maxMcap * 0.8) {
    holdMaxMs = Math.min(holdMaxMs, 180 * 1000);
    reasons.push("near max mcap");
  }

  return {
    holdMinMs,
    holdMaxMs,
    takeProfitPercent,
    stopLossPercent,
    reason: reasons.length ? reasons.join(", ") : "default",
  };
}

/** Pick one option based on a deterministic hash of input (same coin = same pick, different coins = varied). */
function pick<T>(options: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length]!;
}

/** Build a unique, coin-specific "why bought" narrative in chud voice. */
export function buildNarrativeWhy(
  coin: CandidateCoin,
  plan: HoldPlan,
  holderStats?: HolderStats | null,
  ageMinutes?: number
): string {
  const seed = coin.mint + coin.symbol;
  const sym = coin.symbol || "???";
  const name = coin.name || sym;

  const openers = [
    `bought $${sym} because the ticker felt illegal and i respected that.`,
    `aped $${sym}. ${name} looked like chaos and i am professionally unqualified.`,
    `took $${sym} because my inner risk manager is a goldfish.`,
    `entered $${sym}. i had a vision and zero evidence.`,
  ];
  const middle = [
    "if this sends, i am a genius. if it nukes, it was tuition.",
    "this is either a masterclass or a police report.",
    "i call this setup: confident nonsense with a stop button.",
    "my thesis is vibes, timing, and a little bit of delusion.",
  ];
  const closer: string[] = [];
  if (ageMinutes != null) {
    closer.push(
      ageMinutes < 10
        ? `coin is fresh (${ageMinutes}m old), so we are early or we are cooked.`
        : `coin is ${ageMinutes}m old, so i am either right on time or late with confidence.`
    );
  }
  if (holderStats) {
    closer.push(
      holderStats.isGoodHolders
        ? `holder spread looks decent, so at least i am not alone in this bad idea.`
        : `holder spread is sketchy, so i am sizing this like i enjoy sleep.`
    );
  }
  if (plan.reason && plan.reason !== "default") {
    closer.push(`risk brain says: ${plan.reason}. vibes brain said buy anyway.`);
  }

  return [pick(openers, seed), pick(middle, seed + "m"), ...closer].join(" ").trim();
}
