const API = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api").replace(/\/+$/, "");

async function apiFetch(path: string): Promise<Response> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    let msg = `API ${path}: ${res.status}`;
    try {
      const j = JSON.parse(text);
      if (j?.error) msg = j.error;
      else if (j?.message) msg = j.message;
    } catch {
      if (text) msg += " " + text.slice(0, 200);
    }
    throw new Error(msg);
  }
  return res;
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

export interface CandidateCoin {
  mint: string;
  symbol: string;
  name: string;
  reason: string;
  volumeUsd?: number;
  mcapUsd?: number;
  pairCreatedAt?: number;
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

export interface BalanceChartPoint {
  timestamp: string;
  balanceSol: number;
}

export async function fetchTrades(): Promise<TradeRecord[]> {
  const res = await apiFetch("/trades");
  const data = await res.json();
  return data.trades ?? [];
}

export async function fetchLatestTrades(limit = 10): Promise<TradeRecord[]> {
  const res = await apiFetch(`/trades/latest?limit=${limit}`);
  const data = await res.json();
  return data.trades ?? [];
}

export async function fetchBalance(): Promise<number> {
  const res = await apiFetch("/balance");
  const data = await res.json();
  return data.balanceSol ?? 0;
}

export interface WalletStatus {
  tradingWalletPubkey: string | null;
  expectedWalletPubkey?: string;
  pubkeyMatchesExpected?: boolean;
  hint?: string;
}

export async function fetchWalletStatus(): Promise<WalletStatus> {
  const res = await apiFetch("/wallet-status");
  const data = await res.json();
  return {
    tradingWalletPubkey: data.tradingWalletPubkey ?? null,
    expectedWalletPubkey: data.expectedWalletPubkey,
    pubkeyMatchesExpected: data.pubkeyMatchesExpected,
    hint: data.hint,
  };
}

export async function fetchPnl(): Promise<{ totalPnlSol: number; tradeCount: number }> {
  const res = await apiFetch("/pnl");
  const data = await res.json();
  return { totalPnlSol: data.totalPnlSol ?? 0, tradeCount: data.tradeCount ?? 0 };
}

export async function fetchBalanceChart(): Promise<{ points: BalanceChartPoint[] }> {
  const res = await apiFetch("/balance/chart");
  const data = await res.json();
  return { points: data.points ?? [] };
}

export async function fetchChudState(): Promise<ChudState | null> {
  const res = await apiFetch("/chud/state");
  const data = await res.json();
  return data;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  symbol?: string;
  pnlPercent?: number;
  holdMin?: number;
  reason?: string;
}

export async function fetchLogs(limit = 100): Promise<LogEntry[]> {
  const res = await apiFetch(`/logs?limit=${limit}`);
  const data = await res.json();
  return data.logs ?? [];
}

export interface FiltersConfig {
  minVolumeUsd?: number;
  minMcapUsd?: number;
  maxMcapUsd?: number;
  minGlobalFeesPaidSol?: number;
  maxAgeMinutes?: number;
  holdMinSeconds?: number;
  holdMaxSeconds?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
}

export async function fetchFilters(): Promise<FiltersConfig> {
  const res = await apiFetch("/filters");
  return res.json();
}

export interface CoachMessage {
  id: string;
  at: string;
  text: string;
}

export async function fetchCoachMessages(): Promise<CoachMessage[]> {
  const res = await apiFetch("/coach/messages");
  const data = await res.json();
  return data.messages ?? [];
}

export interface ChudChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  at: string;
}

export async function fetchChudChat(): Promise<{ messages: ChudChatTurn[]; llmConfigured: boolean }> {
  const res = await apiFetch("/chat/messages");
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    llmConfigured: data.llmConfigured === true,
  };
}

export async function postChudChat(text: string, alsoCoachNote = false): Promise<{ user: ChudChatTurn; assistant: ChudChatTurn }> {
  const res = await fetch(`${API}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, alsoCoachNote }),
  });
  if (!res.ok) {
    const textBody = await res.text();
    let msg = `API /chat/messages: ${res.status}`;
    try {
      const j = JSON.parse(textBody);
      if (j?.error) msg = j.error;
    } catch {
      if (textBody) msg += " " + textBody.slice(0, 200);
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { user?: ChudChatTurn; assistant?: ChudChatTurn };
  if (!data.user || !data.assistant) throw new Error("Bad chat response");
  return { user: data.user, assistant: data.assistant };
}

export async function postChudChatClear(): Promise<void> {
  const res = await fetch(`${API}/chat/clear`, { method: "POST" });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `clear failed ${res.status}`);
  }
}

/** Latest auto line for X (outbox file); soft-fail so the main poll never breaks. */
export interface ChudOutboxResponse {
  text: string | null;
  at: string | null;
  hint?: string;
}

export async function fetchChudOutbox(): Promise<ChudOutboxResponse> {
  try {
    const res = await fetch(`${API}/chud/outbox`);
    if (!res.ok) {
      return { text: null, at: null, hint: `outbox unavailable (${res.status})` };
    }
    return (await res.json()) as ChudOutboxResponse;
  } catch {
    return { text: null, at: null, hint: "could not reach backend" };
  }
}

/** Same JSON as GET /api/agent/position (OpenClaw + site). */
export interface AgentPositionResponse {
  openTrade: TradeRecord | null;
  quote?: {
    currentPriceUsd: number | null;
    unrealizedPnlPercent: number | null;
    unrealizedPnlSol: number | null;
    buyPriceUsd: number | null;
    holdSeconds: number;
  };
}

export async function fetchAgentPosition(): Promise<AgentPositionResponse | null> {
  try {
    const res = await fetch(`${API}/agent/position`);
    if (!res.ok) return null;
    return (await res.json()) as AgentPositionResponse;
  } catch {
    return null;
  }
}

export async function postCoachMessage(text: string): Promise<CoachMessage> {
  const res = await fetch(`${API}/coach/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const textBody = await res.text();
    let msg = `API /coach/messages: ${res.status}`;
    try {
      const j = JSON.parse(textBody);
      if (j?.error) msg = j.error;
    } catch {
      if (textBody) msg += " " + textBody.slice(0, 200);
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { message?: CoachMessage };
  if (!data.message) throw new Error("No message returned");
  return data.message;
}
