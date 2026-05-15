/**
 * On-chain wallet stats for chart + PnL (standard RPC tx walk; Helius gTFA optional).
 */
import { getWalletBalanceHistoryPointsCached, type BalanceHistoryPoint } from "./wallet-balance-history.js";
import { getWalletPnlTracker } from "./wallet-pnl-tracker.js";
import { getWalletBalanceSol } from "./trade.js";

export interface WalletStats {
  balanceSol: number;
  totalPnlSol: number;
  lifetimeDepositedSol: number;
  chartPoints: BalanceHistoryPoint[];
  source: "chain" | "trades_fallback";
}

export async function getWalletStats(): Promise<WalletStats> {
  const chartPoints = await getWalletBalanceHistoryPointsCached();
  const live = await getWalletBalanceSol();
  const balanceSol = live ?? chartPoints[chartPoints.length - 1]?.balanceSol ?? 0;

  if (chartPoints.length >= 2) {
    const sorted = [...chartPoints].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const last = sorted[sorted.length - 1]!;
    const withNow =
      Math.abs(last.balanceSol - balanceSol) > 0.0001
        ? [...sorted, { timestamp: new Date().toISOString(), balanceSol }]
        : sorted;
    const pnl = await getWalletPnlTracker({
      firstBalanceSol: sorted[0]?.balanceSol ?? null,
      chartPoints: sorted,
    });
    return {
      balanceSol,
      totalPnlSol: pnl.totalPnlSol,
      lifetimeDepositedSol: pnl.lifetimeNetDepositSol,
      chartPoints: withNow,
      source: "chain",
    };
  }

  const pnl = await getWalletPnlTracker({
    firstBalanceSol: chartPoints[0]?.balanceSol ?? null,
    chartPoints,
  });
  return {
    balanceSol,
    totalPnlSol: pnl.totalPnlSol,
    lifetimeDepositedSol: pnl.lifetimeNetDepositSol,
    chartPoints: balanceSol > 0 ? [{ timestamp: new Date().toISOString(), balanceSol }] : [],
    source: "trades_fallback",
  };
}
