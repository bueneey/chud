import type { TradeRecord, CandidateCoin, Filters } from "./types.js";
import { appendTrade } from "./storage.js";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { loadKeypair } from "./wallet.js";

const LAMPORTS_PER_SOL = 1e9;

/** Get current wallet SOL balance (for accurate PnL when wallet is linked). Returns null if no wallet/RPC. */
export async function getWalletBalanceSol(): Promise<number | null> {
  const r = await getWalletBalanceWithError();
  return r.balance;
}

/** Same as getWalletBalanceSol but returns the actual error for debugging. */
export async function getWalletBalanceWithError(): Promise<{ balance: number | null; error?: string }> {
  const keypair = loadKeypair();
  const rpc = process.env.SOLANA_RPC_URL?.trim();
  if (!keypair) return { balance: null, error: "No keypair (WALLET_PRIVATE_KEY invalid or missing)" };
  if (!rpc) return { balance: null, error: "SOLANA_RPC_URL not set" };
  try {
    const conn = new Connection(rpc);
    const lamports = await conn.getBalance(keypair.publicKey);
    return { balance: lamports / LAMPORTS_PER_SOL };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { balance: null, error: msg };
  }
}

function pumpPortalTradeLocalUrl(): string {
  const base = "https://pumpportal.fun/api/trade-local";
  const key = (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim();
  if (key) return `${base}?api-key=${encodeURIComponent(key)}`;
  return base;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function fetchSerializedTx(params: {
  publicKey: string;
  action: "buy" | "sell";
  mint: string;
  amount: string;
  denominatedInSol: string;
  slippage: number;
  priorityFee: number;
  pool: string;
}): Promise<ArrayBuffer> {
  const body = new URLSearchParams({
    publicKey: params.publicKey,
    action: params.action,
    mint: params.mint,
    amount: params.amount,
    denominatedInSol: params.denominatedInSol,
    slippage: String(params.slippage),
    priorityFee: String(params.priorityFee),
    pool: params.pool,
  });
  const url = pumpPortalTradeLocalUrl();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const raw = await res.arrayBuffer();
  const buf = new Uint8Array(raw);
  const looksJson = buf.length > 0 && buf[0] === 0x7b; // '{'
  if (!res.ok || looksJson) {
    const text = new TextDecoder().decode(buf);
    const trimmed = text.trimStart();
    let msg = text.slice(0, 800);
    try {
      const j = JSON.parse(trimmed) as { error?: { message?: string; code?: number }; message?: string };
      msg = j.error?.message ?? j.message ?? msg;
    } catch {
      /* keep msg */
    }
    const hint =
      /missing api key|32401/i.test(msg)
        ? " Fix: put your RPC provider’s key in SOLANA_RPC_URL (e.g. Helius …?api-key=…) and/or set PUMPPORTAL_API_KEY from https://www.pumpportal.fun/trading-api/setup/ — Chud’s agent API does not use this key."
        : "";
    throw new Error(`PumpPortal ${params.action} (HTTP ${res.status}): ${msg}${hint}`);
  }
  return raw;
}

export async function executeBuy(
  candidate: CandidateCoin,
  solAmount: number,
  filters: Filters
): Promise<{ tokenAmount: number; tx?: string }> {
  const keypair = loadKeypair();
  const rpc = process.env.SOLANA_RPC_URL;
  if (!keypair || !rpc) {
    // Demo: fake numbers
    const tokenAmount = Math.floor(solAmount * 1e6 * (5000 + Math.random() * 5000));
    return { tokenAmount, tx: "demo_buy_" + genId() };
  }

  const amountLamports = Math.floor(solAmount * 1e9);
  const buf = await fetchSerializedTx({
    publicKey: keypair.publicKey.toBase58(),
    action: "buy",
    mint: candidate.mint,
    amount: String(amountLamports),
    denominatedInSol: "true",
    slippage: filters.slippagePercent ?? 15,
    priorityFee: filters.priorityFeeSol ?? 0.0001,
    pool: "auto",
  });
  const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
  tx.sign([keypair]);
  const conn = new Connection(rpc);

  let sig: string;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sig = await conn.sendTransaction(tx, {
        skipPreflight: attempt >= 2,
        maxRetries: 3,
      });
      break;
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("Blockhash not found") && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (/missing api key|32401/i.test(msg)) {
        throw new Error(
          `${msg} [HINT] Your SOLANA_RPC_URL probably needs the provider’s API key in the URL (e.g. Helius/QuickNode). Optional: PUMPPORTAL_API_KEY from https://www.pumpportal.fun/trading-api/setup/`
        );
      }
      throw e;
    }
  }
  /** Placeholder until we parse mint balance from chain; huge values break PnL math in quotes. */
  const tokenAmount = Math.max(1, Math.min(1e15, Math.round(solAmount * 1e9)));
  return { tokenAmount, tx: sig! };
}

export async function executeSell(
  mint: string,
  tokenAmount: number,
  filters: Filters
): Promise<{ solReceived: number; tx?: string }> {
  const keypair = loadKeypair();
  const rpc = process.env.SOLANA_RPC_URL;
  if (!keypair || !rpc) {
    return { solReceived: 0, tx: "demo_sell_" + genId() };
  }

  const conn = new Connection(rpc);
  const balBefore = await conn.getBalance(keypair.publicKey);

  const poolList = (
    process.env.CHUD_SELL_POOL_FALLBACKS ||
    "auto,raydium,pump-amm,raydium-cpmm,launchlab,bonk,pump"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  let buf: ArrayBuffer | null = null;
  let lastErr: Error | null = null;
  for (const pool of poolList) {
    try {
      buf = await fetchSerializedTx({
        publicKey: keypair.publicKey.toBase58(),
        action: "sell",
        mint,
        amount: "100%",
        denominatedInSol: "false",
        slippage: filters.slippagePercent ?? 15,
        priorityFee: filters.priorityFeeSol ?? 0.0001,
        pool,
      });
      lastErr = null;
      console.log("[Chud] PumpPortal sell using pool:", pool);
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn("[Chud] sell pool", pool, "→", lastErr.message.slice(0, 120));
    }
  }
  if (!buf) {
    throw lastErr ?? new Error("PumpPortal sell failed for all pools (token may have graduated off pump bonding curve — try force-close if position is stuck)");
  }
  const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
  tx.sign([keypair]);

  let sig: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sig = await conn.sendTransaction(tx, {
        skipPreflight: attempt >= 2,
        maxRetries: 3,
      });
      break;
    } catch (e: unknown) {
      const msg = String((e as Error)?.message ?? e);
      if (msg.includes("Blockhash not found") && attempt < 2) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (/missing api key|32401/i.test(msg)) {
        throw new Error(
          `${msg} [HINT] Fix SOLANA_RPC_URL (include provider api-key) and/or set PUMPPORTAL_API_KEY — see env.example`
        );
      }
      throw e;
    }
  }

  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig!, blockhash, lastValidBlockHeight }, "confirmed");

  const balAfter = await conn.getBalance(keypair.publicKey);
  const solReceived = Math.max(0, (balAfter - balBefore) / LAMPORTS_PER_SOL);
  return { solReceived, tx: sig! };
}

/** Record a buy immediately so the trade feed shows the BUY when Live Claw does. */
export function recordOpenBuy(
  symbol: string,
  name: string,
  mint: string,
  why: string,
  buySol: number,
  buyTokenAmount: number,
  buyTimestamp: string,
  txBuy?: string,
  mcapUsd?: number,
  volumeAtBuyUsd?: number,
  ageMinutesAtBuy?: number
): TradeRecord {
  const record: TradeRecord = {
    id: genId(),
    mint,
    symbol,
    name,
    why,
    mcapUsd,
    volumeAtBuyUsd,
    ageMinutesAtBuy,
    buySol,
    buyTokenAmount,
    buyTimestamp,
    sellSol: 0,
    sellTokenAmount: buyTokenAmount,
    sellTimestamp: "",
    holdSeconds: 0,
    pnlSol: 0,
    txBuy,
  };
  appendTrade(record);
  return record;
}

export function recordTrade(
  symbol: string,
  name: string,
  mint: string,
  why: string,
  buySol: number,
  buyTokenAmount: number,
  buyTimestamp: string,
  sellSol: number,
  sellTokenAmount: number,
  sellTimestamp: string,
  txBuy?: string,
  txSell?: string,
  mcapUsd?: number,
  mcapAtSellUsd?: number
): TradeRecord {
  const holdSeconds = Math.round(
    (new Date(sellTimestamp).getTime() - new Date(buyTimestamp).getTime()) / 1000
  );
  const pnlSol = sellSol - buySol;
  const record: TradeRecord = {
    id: genId(),
    mint,
    symbol,
    name,
    why,
    mcapUsd,
    mcapAtSellUsd,
    buySol,
    buyTokenAmount,
    buyTimestamp,
    sellSol,
    sellTokenAmount,
    sellTimestamp,
    holdSeconds,
    pnlSol,
    txBuy,
    txSell,
  };
  appendTrade(record);
  return record;
}
