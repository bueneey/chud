import type { TradeRecord, CandidateCoin, Filters } from "./types.js";
import { appendTrade, appendLog } from "./storage.js";
import { Connection, Keypair, VersionedTransaction, PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { loadKeypair } from "./wallet.js";

const LAMPORTS_PER_SOL = 1e9;

/** Paginate signature history until the true oldest (or WALLET_BIRTH_FETCH_MAX_PAGES). */
const WALLET_BIRTH_FETCH_MAX_PAGES = 300;

let walletBirthResolved = false;
let walletBirthMs: number | null = null;
let walletBirthNextTryMs = 0;

function resolveWalletPubkeyForHistory(): PublicKey | null {
  const kp = loadKeypair();
  if (kp) return kp.publicKey;
  const pub = process.env.CHUD_WALLET_PUBLIC?.trim();
  if (!pub) return null;
  try {
    return new PublicKey(pub);
  } catch {
    return null;
  }
}

/**
 * First on-chain activity for this wallet (oldest signature), via RPC pagination.
 * Cached for the process after success; on RPC errors retries after a cooldown.
 * Uses WALLET_PRIVATE_KEY pubkey, or CHUD_WALLET_PUBLIC if no keypair (read-only).
 */
export async function getWalletFirstOnChainActivityMs(): Promise<number | null> {
  if (walletBirthResolved) return walletBirthMs;
  const now = Date.now();
  if (now < walletBirthNextTryMs) return null;

  const rpc = process.env.SOLANA_RPC_URL?.trim();
  const pubkey = resolveWalletPubkeyForHistory();
  if (!rpc || !pubkey) {
    walletBirthResolved = true;
    walletBirthMs = null;
    return null;
  }

  try {
    const conn = new Connection(rpc);
    let before: string | undefined;
    let oldest: { signature: string; blockTime?: number | null } | null = null;

    for (let page = 0; page < WALLET_BIRTH_FETCH_MAX_PAGES; page++) {
      const batch = await conn.getSignaturesForAddress(pubkey, { before, limit: 1000 }, "confirmed");
      if (batch.length === 0) break;
      oldest = batch[batch.length - 1]!;
      before = oldest.signature;
      if (batch.length < 1000) break;
    }

    if (!oldest) {
      walletBirthResolved = true;
      walletBirthMs = null;
      return null;
    }

    if (oldest.blockTime != null && Number.isFinite(oldest.blockTime)) {
      walletBirthMs = oldest.blockTime * 1000;
      walletBirthResolved = true;
      return walletBirthMs;
    }

    const tx = await conn.getTransaction(oldest.signature, { maxSupportedTransactionVersion: 0 });
    const bt = tx?.blockTime;
    if (bt != null && Number.isFinite(bt)) {
      walletBirthMs = bt * 1000;
      walletBirthResolved = true;
      return walletBirthMs;
    }

    walletBirthResolved = true;
    walletBirthMs = null;
    return null;
  } catch {
    walletBirthNextTryMs = Date.now() + 120_000;
    return null;
  }
}

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

/**
 * PumpPortal **trade-local** signs with YOUR wallet (`publicKey` in the form body).
 * API keys from the “Lightning wallet” flow are for **`/api/trade`** (Portal signs that wallet), not for pairing
 * with a different pubkey on trade-local — sending `?api-key=` + mismatched wallet → **HTTP 400**.
 * Opt in only if you have a key Portal documents for local tx: `PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL=1`.
 */
function pumpPortalTradeLocalUrl(): string {
  const base = "https://pumpportal.fun/api/trade-local";
  const key = (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim();
  const append =
    process.env.PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL === "1" ||
    process.env.PUMPPORTAL_USE_KEY_ON_TRADE_LOCAL === "1";
  if (key && append) return `${base}?api-key=${encodeURIComponent(key)}`;
  return base;
}

/** True when a PumpPortal key is present in env (may or may not be sent on trade-local — see append flag). */
export function isPumpPortalApiKeyConfigured(): boolean {
  return (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim().length > 0;
}

export function isPumpPortalKeyAppendedToTradeLocal(): boolean {
  const key = (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim();
  if (!key) return false;
  return (
    process.env.PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL === "1" ||
    process.env.PUMPPORTAL_USE_KEY_ON_TRADE_LOCAL === "1"
  );
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** True when `buyTokenAmount` is the legacy lamports-shaped placeholder (≈ buySol × 1e9), not SPL ui amount. */
export function isPlaceholderBuyTokenAmount(buySol: number, buyTokenAmount: number): boolean {
  if (!Number.isFinite(buySol) || !Number.isFinite(buyTokenAmount) || buyTokenAmount <= 0) return false;
  const lam = Math.round(buySol * LAMPORTS_PER_SOL);
  return Math.abs(buyTokenAmount - lam) <= 1;
}

/** Wait until signature is processed; throw if chain reports `err` or timeout. */
async function confirmSignatureSucceededOrThrow(conn: Connection, signature: string): Promise<void> {
  const timeoutMs = Math.min(120_000, Math.max(8_000, Number(process.env.CHUD_TX_CONFIRM_MS ?? "45000") || 45_000));
  const pollMs = 400;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { value } = await conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const st = value[0];
    if (st?.err) {
      const errStr = typeof st.err === "object" ? JSON.stringify(st.err) : String(st.err);
      throw new Error(`Transaction failed on-chain (${signature.slice(0, 12)}…): ${errStr}`);
    }
    if (
      st?.confirmationStatus === "processed" ||
      st?.confirmationStatus === "confirmed" ||
      st?.confirmationStatus === "finalized"
    ) {
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Confirmation timeout for ${signature.slice(0, 12)}…`);
}

/** Sum SPL token ui amount for `mint` across the wallet’s parsed token accounts. */
async function readWalletTokenUiAmount(conn: Connection, owner: PublicKey, mint: string): Promise<number> {
  const mintPk = new PublicKey(mint);
  const { value: accounts } = await conn.getParsedTokenAccountsByOwner(owner, { mint: mintPk }, "confirmed");
  let sum = 0;
  for (const row of accounts) {
    const data = row.account.data as ParsedAccountData;
    const info = data.parsed?.info as
      | { mint?: string; tokenAmount?: { uiAmount?: number | null; amount?: string; decimals?: number } }
      | undefined;
    if (!info?.mint || info.mint !== mint || !info.tokenAmount) continue;
    const ta = info.tokenAmount;
    if (ta?.uiAmount != null && Number.isFinite(ta.uiAmount)) {
      sum += ta.uiAmount;
    } else if (ta?.amount != null && ta.decimals != null) {
      sum += Number(ta.amount) / 10 ** ta.decimals;
    }
  }
  return sum;
}

async function readWalletTokenUiAmountWithRetry(
  conn: Connection,
  owner: PublicKey,
  mint: string,
  opts: { attempts: number; delayMs: number }
): Promise<number> {
  for (let i = 0; i < opts.attempts; i++) {
    const n = await readWalletTokenUiAmount(conn, owner, mint);
    if (n > 0) return n;
    if (i + 1 < opts.attempts) await new Promise((r) => setTimeout(r, opts.delayMs));
  }
  return 0;
}

function normalizePumpPortalField(raw: string): string {
  return raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
}

function assertPumpPortalPubkeys(publicKey: string, mint: string): void {
  try {
    new PublicKey(publicKey);
    new PublicKey(mint);
  } catch {
    throw new Error(
      `Invalid Solana publicKey or mint for PumpPortal (bad paste / encoding?). pubkeyLen=${publicKey.length} mintLen=${mint.length}`
    );
  }
}

function portalErrorMessage(buf: Uint8Array): string {
  const text = new TextDecoder().decode(buf);
  const trimmed = text.trimStart();
  let msg = text.slice(0, 800);
  try {
    const j = JSON.parse(trimmed) as { error?: { message?: string; code?: number }; message?: string };
    msg = j.error?.message ?? j.message ?? msg;
  } catch {
    /* keep plain text e.g. "Bad Request" */
  }
  return msg;
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
  const publicKey = normalizePumpPortalField(params.publicKey);
  const mint = normalizePumpPortalField(params.mint);
  assertPumpPortalPubkeys(publicKey, mint);

  const url = pumpPortalTradeLocalUrl();
  const fetchMs = Math.min(120_000, Math.max(12_000, Number(process.env.CHUD_PUMPPORTAL_FETCH_MS ?? "45000") || 45_000));

  const amountJson: string | number =
    params.denominatedInSol === "true" ? Number(params.amount) : params.amount;
  if (params.denominatedInSol === "true" && (!Number.isFinite(amountJson as number) || (amountJson as number) <= 0)) {
    throw new Error(`PumpPortal buy invalid SOL amount: ${params.amount}`);
  }

  const formBody = new URLSearchParams({
    publicKey,
    action: params.action,
    mint,
    amount: params.amount,
    denominatedInSol: params.denominatedInSol,
    slippage: String(params.slippage),
    priorityFee: String(params.priorityFee),
    pool: params.pool,
  });

  const jsonBody = {
    publicKey,
    action: params.action,
    mint,
    amount: amountJson,
    denominatedInSol: params.denominatedInSol,
    slippage: params.slippage,
    priorityFee: params.priorityFee,
    pool: params.pool,
  };

  const headersBase = { Accept: "application/octet-stream, application/json;q=0.9, */*;q=0.8" as const };

  async function postPortal(encoding: "form" | "json"): Promise<{ res: Response; raw: ArrayBuffer }> {
    const res = await fetch(url, {
      method: "POST",
      headers:
        encoding === "form"
          ? { ...headersBase, "Content-Type": "application/x-www-form-urlencoded" }
          : { ...headersBase, "Content-Type": "application/json" },
      body: encoding === "form" ? formBody.toString() : JSON.stringify(jsonBody),
      signal: AbortSignal.timeout(fetchMs),
    });
    const raw = await res.arrayBuffer();
    return { res, raw };
  }

  let { res, raw } = await postPortal("form");
  let buf = new Uint8Array(raw);
  let looksJson = buf.length > 0 && buf[0] === 0x7b;

  if (!res.ok || looksJson) {
    let msg = portalErrorMessage(buf);
    const retryJson =
      res.status === 400 &&
      (/^Bad Request$/i.test(msg.trim()) || msg.trim().length === 0 || /^unexpected/i.test(msg));
    if (retryJson) {
      ({ res, raw } = await postPortal("json"));
      buf = new Uint8Array(raw);
      looksJson = buf.length > 0 && buf[0] === 0x7b;
      msg = portalErrorMessage(buf);
    }

    if (!res.ok || looksJson) {
      appendLog({
        type: "error",
        message: `PumpPortal ${params.action} HTTP ${res.status} pool=${params.pool} mint=${mint.slice(0, 8)}… ${msg.slice(0, 280)}`,
        symbol: mint.slice(0, 12),
      });
      let hint = "";
      if (/missing api key|32401/i.test(msg)) {
        hint =
          " Fix: put your RPC provider’s key in SOLANA_RPC_URL (e.g. Helius …?api-key=…) and/or set PUMPPORTAL_API_KEY from https://www.pumpportal.fun/trading-api/setup/ — Chud’s agent API does not use this key.";
      } else if (res.status === 400 && isPumpPortalKeyAppendedToTradeLocal()) {
        hint =
          " Hint: `?api-key=` on trade-local is for keys Portal allows with YOUR signing wallet. Lightning-wallet keys usually only match `/api/trade`. Unset PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL (default).";
      } else if (res.status === 400) {
        hint =
          ` Hint: pool=${params.pool} often 400s for bonding-curve mints (try CHUD_BUY_POOL_FALLBACKS=pump,auto,...). Deploy latest backend; bogus mint/zw-spaces fixed server-side.`;
      }
      throw new Error(`PumpPortal ${params.action} (HTTP ${res.status}): ${msg}${hint}`);
    }
  }
  return raw;
}

/** Default: only `pump` + `auto` (bonding curve). Longer lists multiply on-chain attempts and feel “hung”. Override via CHUD_BUY_POOL_FALLBACKS for graduated names. */
const DEFAULT_BUY_POOL_FALLBACKS = "pump,auto";

function buyPoolFallbackList(): string[] {
  const raw = process.env.CHUD_BUY_POOL_FALLBACKS?.trim() || DEFAULT_BUY_POOL_FALLBACKS;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * True if another PumpPortal `pool` may fix the failure (wrong venue vs bonding curve / PumpSwap / Raydium).
 * Pump custom 6021 = notEnoughTokensToBuy; 6024 = overflow (often post-upgrade / bad account layout — new pool helps sometimes).
 */
function buyFailureMayTryNextPool(errMsg: string): boolean {
  if (/missing api key|32401|Blockhash not found|insufficient funds|0x1\b/i.test(errMsg)) return false;
  return (
    /\b6021\b|\b6024\b|0x1785|0x1788|notEnoughTokensToBuy|BondingCurveComplete|curve complete|InstructionError/i.test(
      errMsg
    ) || /PumpPortal buy \(HTTP/i.test(errMsg)
  );
}

async function sendSignedVersionedTxWithRetries(
  conn: Connection,
  tx: VersionedTransaction
): Promise<string> {
  let sig: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      sig = await conn.sendTransaction(tx, {
        skipPreflight: attempt >= 2,
        maxRetries: 3,
      });
      return sig;
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
  throw new Error("sendTransaction: exhausted retries");
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

  const amountSolText = Number(solAmount.toFixed(6)).toString();
  const conn = new Connection(rpc);
  const pools = buyPoolFallbackList();
  let lastErr: Error | null = null;
  const attempts: string[] = [];

  for (let pi = 0; pi < pools.length; pi++) {
    const pool = pools[pi]!;
    try {
      const buf = await fetchSerializedTx({
        publicKey: keypair.publicKey.toBase58(),
        action: "buy",
        mint: candidate.mint,
        amount: amountSolText,
        denominatedInSol: "true",
        slippage: filters.slippagePercent ?? 15,
        priorityFee: filters.priorityFeeSol ?? 0.0001,
        pool,
      });
      const tx = VersionedTransaction.deserialize(new Uint8Array(buf));
      tx.sign([keypair]);
      const sig = await sendSignedVersionedTxWithRetries(conn, tx);
      await confirmSignatureSucceededOrThrow(conn, sig);
      const tokenUi = await readWalletTokenUiAmountWithRetry(conn, keypair.publicKey, candidate.mint, {
        attempts: 12,
        delayMs: 750,
      });
      if (!(tokenUi > 0)) {
        throw new Error(
          `Buy transaction confirmed but wallet still shows 0 ${candidate.symbol} (${candidate.mint.slice(0, 8)}…) — check RPC / mint, or retry.`
        );
      }
      console.log("[Chud] buy ok pool=%s mint=%s…", pool, candidate.mint.slice(0, 8));
      return { tokenAmount: tokenUi, tx: sig };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      lastErr = e instanceof Error ? e : new Error(msg);
      attempts.push(`${pool}: ${msg.slice(0, 220)}`);
      const hasNext = pi < pools.length - 1;
      if (hasNext && buyFailureMayTryNextPool(msg)) {
        console.warn("[Chud] buy pool %s failed → try next (%s)", pool, msg.slice(0, 200));
        continue;
      }
      const attemptSummary = attempts.slice(-6).join(" | ");
      throw new Error(
        `${msg} [pool-attempts] ${attemptSummary || "(none)"}`
      );
    }
  }

  const attemptSummary = attempts.slice(-6).join(" | ");
  throw new Error(
    (lastErr?.message || "PumpPortal buy failed for all pools in CHUD_BUY_POOL_FALLBACKS") +
      ` [pool-attempts] ${attemptSummary || "(none)"}`
  );
}

export async function executeSell(
  mint: string,
  tokenAmount: number,
  filters: Filters,
  opts?: { sellPercent?: number }
): Promise<{ solReceived: number; tx?: string }> {
  const pct = opts?.sellPercent ?? 100;
  const amountStr = pct >= 100 ? "100%" : pct <= 0 ? "100%" : `${Math.min(100, Math.max(1, Math.round(pct)))}%`;
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
        amount: amountStr,
        denominatedInSol: "false",
        slippage: filters.slippagePercent ?? 15,
        priorityFee: filters.priorityFeeSol ?? 0.0001,
        pool,
      });
      lastErr = null;
      console.log("[Chud] PumpPortal sell using pool:", pool, "amount:", amountStr);
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

  await confirmSignatureSucceededOrThrow(conn, sig!);

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
