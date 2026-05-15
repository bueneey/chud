import type { HoldPlan } from "./types.js";
import type { PositionQuote } from "./llm.js";

export type SellRuleAction =
  | { kind: "hold" }
  | { kind: "sell_all"; reason: string }
  | { kind: "sell_partial"; fraction: number; reason: string };

/**
 * Hard exits before LLM: -30% stop, 50% off at 2x (initials), optional full exit at 3x on remainder.
 */
export function evaluateSellRules(
  quote: PositionQuote,
  plan: HoldPlan,
  opts: { initialsTaken?: boolean }
): SellRuleAction {
  const pnl = quote.unrealizedPnlPercent;
  if (pnl == null || !Number.isFinite(pnl)) return { kind: "hold" };

  const stop = plan.stopLossPercent;
  if (pnl <= stop) {
    return { kind: "sell_all", reason: `Stop loss ${pnl.toFixed(1)}% (limit ${stop}%)` };
  }

  const tp2x = plan.takeProfitPercent >= 100 ? plan.takeProfitPercent : 100;
  if (!opts.initialsTaken && pnl >= tp2x) {
    return {
      kind: "sell_partial",
      fraction: 0.5,
      reason: `Took 50% initials at ~${pnl.toFixed(0)}% (+${tp2x}% target)`,
    };
  }

  if (opts.initialsTaken && pnl >= 200) {
    return { kind: "sell_all", reason: `Runner exit ~${pnl.toFixed(0)}% on remaining bag` };
  }

  if (!opts.initialsTaken && pnl >= 150) {
    return { kind: "sell_all", reason: `Full take profit ~${pnl.toFixed(0)}%` };
  }

  return { kind: "hold" };
}
