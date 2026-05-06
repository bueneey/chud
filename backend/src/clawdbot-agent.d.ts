declare module "clawdbot/agent" {
  export interface AgentPosition {
    state: { kind: string; chosenSymbol?: string; chosenMint?: string } | null;
    openTrade: {
      mint: string;
      symbol: string;
      buySol: number;
      buyTokenAmount: number;
    } | null;
  }
  export interface BuyParams {
    mint: string;
    symbol: string;
    name: string;
    reason?: string;
    amountSol?: number;
  }
  export function getCandidates(): Promise<Array<{ mint: string; symbol: string; name: string; reason: string; mcapUsd?: number; volumeUsd?: number }>>;
  export function getPosition(): AgentPosition;
  export function getPositionWithQuote(): Promise<AgentPosition & { quote?: { currentPriceUsd: number | null; unrealizedPnlPercent: number | null; unrealizedPnlSol: number | null; holdSeconds: number } }>;
  export function buy(params: BuyParams): Promise<
    | { ok: true; symbol: string; tx?: string }
    | { ok: false; error: string }
  >;
  export function sell(params?: { reason?: string }): Promise<
    | { ok: true; symbol: string; pnlSol: number; tx?: string }
    | { ok: false; error: string }
  >;
  export function forceClosePosition(params: { reason: string }): Promise<
    | { ok: true; symbol: string; mint: string }
    | { ok: false; error: string }
  >;
  export function getWalletBalanceSol(): Promise<number | null>;
  export function getWalletBalanceWithError(): Promise<{ balance: number | null; error?: string }>;
}

declare module "clawdbot" {
  export function startTradingLoop(): Promise<never>;
}

declare module "clawdbot/coach-notes" {
  export interface CoachMessage {
    id: string;
    at: string;
    text: string;
  }
  export function getCoachMessages(limit?: number): CoachMessage[];
  export function appendCoachMessage(text: string): CoachMessage;
}

declare module "clawdbot/outbox" {
  export type ChudOutbox = { text: string; at: string };
  export function readChudOutbox(): ChudOutbox | null;
}

declare module "clawdbot/chud-chat" {
  export type ChudChatRole = "user" | "assistant";
  export interface ChudChatTurn {
    id: string;
    role: ChudChatRole;
    content: string;
    at: string;
  }
  export function getChudChatMessages(limit?: number): ChudChatTurn[];
  export function chudChatLlmConfigured(): boolean;
  export function sendChudChatUserMessage(
    userText: string,
    options?: { alsoCoachNote?: boolean }
  ): Promise<{ user: ChudChatTurn; assistant: ChudChatTurn }>;
  export function clearChudChat(): void;
}