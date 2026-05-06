export interface Filters {
  minVolumeUsd: number;
  minMcapUsd: number;
  maxMcapUsd: number;
  minGlobalFeesPaidSol: number;
  maxAgeMinutes: number;
  minPositionSol?: number;
  maxPositionSol: number;
  maxPositionPercent: number;
  maxCandidates: number;
  holdMinSeconds: number;
  holdMaxSeconds: number;
  /** Delay in ms after sell before next buy (0 = no delay, trade immediately) */
  loopDelayMs?: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  slippagePercent: number;
  priorityFeeSol: number;
}

export interface HoldPlan {
  holdMinMs: number;
  holdMaxMs: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  reason: string;
}

export interface CandidateCoin {
  mint: string;
  symbol: string;
  name: string;
  reason: string;
  volumeUsd?: number;
  mcapUsd?: number;
  pairCreatedAt?: number;
  globalFeesPaidSol?: number;
  liquidityUsd?: number;
  /** Holder stats when BIRDEYE_API_KEY set: count, top10%, good/bad */
  holderInfo?: string;
  /** Social/url from metadata when available */
  twitter?: string;
  website?: string;
  /** DexScreener or similar chart URL when available */
  pairUrl?: string;
}

export interface TradeRecord {
  id: string;
  mint: string;
  symbol: string;
  name: string;
  why: string;
  whySold?: string;
  mcapUsd?: number;
  mcapAtSellUsd?: number;
  volumeAtBuyUsd?: number;
  volumeAtSellUsd?: number;
  ageMinutesAtBuy?: number;
  ageMinutesAtSell?: number;
  buySol: number;
  buyTokenAmount: number;
  buyTimestamp: string;
  sellSol: number;
  sellTokenAmount: number;
  sellTimestamp: string;
  holdSeconds: number;
  pnlSol: number;
  txBuy?: string;
  txSell?: string;
}

export type ChudStateKind = "idle" | "thinking" | "choosing" | "bought" | "sold";

export interface ChudState {
  kind: ChudStateKind;
  at: string;
  message?: string;
  candidateCoins?: CandidateCoin[];
  chosenMint?: string;
  chosenSymbol?: string;
  lastTx?: string;
  chosenMcapUsd?: number;
  chosenHolderCount?: number;
  chosenReason?: string;
}
