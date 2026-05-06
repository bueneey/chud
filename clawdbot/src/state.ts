import { setState } from "./storage.js";
import type { ChudState, CandidateCoin } from "./types.js";

export function emitState(s: ChudState): void {
  setState({ ...s, at: new Date().toISOString() });
}

export function emitIdle(): void {
  emitState({ kind: "idle", at: new Date().toISOString() });
}

export function emitThinking(): void {
  emitState({
    kind: "thinking",
    at: new Date().toISOString(),
    message: "Scanning memecoins...",
  });
}

export function emitChoosing(candidates: CandidateCoin[]): void {
  emitState({
    kind: "choosing",
    at: new Date().toISOString(),
    message: "Choosing a coin to buy",
    candidateCoins: candidates,
  });
}

export function emitBought(
  mint: string,
  symbol: string,
  tx?: string,
  mcapUsd?: number,
  holderCount?: number,
  reason?: string
): void {
  emitState({
    kind: "bought",
    at: new Date().toISOString(),
    message: `Bought ${symbol}`,
    chosenMint: mint,
    chosenSymbol: symbol,
    lastTx: tx,
    chosenMcapUsd: mcapUsd,
    chosenHolderCount: holderCount,
    chosenReason: reason,
  });
}

export function emitSold(mint: string, symbol: string, pnlSol: number, tx?: string): void {
  emitState({
    kind: "sold",
    at: new Date().toISOString(),
    message: `Sold ${symbol} • PnL: ${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL`,
    chosenMint: mint,
    chosenSymbol: symbol,
    lastTx: tx,
  });
}
