import { config } from "dotenv";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const envPath = [join(root, ".env"), join(process.cwd(), ".env"), join(process.cwd(), "..", ".env")].find((p) => existsSync(p));
if (envPath) config({ path: envPath });

import express from "express";
import cors from "cors";
import { getPublicKeyBase58 } from "clawdbot/wallet";
import { readChudOutbox, writeChudOutbox } from "./clawdbot-outbox.js";
import { sanitizeAgentBuyBody } from "./clawdbot-sanitize-buy.js";
import { getTrades, getState, getFilters, getLogs } from "./data.js";
import { maybeAppendBalanceSnapshot, readBalanceSnapshots, mergeBalanceChartPoints } from "./balance-snapshots.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT) || 4000;
const isProd = process.env.NODE_ENV === "production";

/** Starting SOL for chart + trades-only balance fallback. Set when you reset bankroll / new wallet. Default 1. */
function chartStartBalanceSol(): number {
  const raw = process.env.CHUD_CHART_START_SOL?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

async function getBalance(): Promise<number> {
  try {
    const { getWalletBalanceSol } = await import("clawdbot/agent");
    const real = await getWalletBalanceSol();
    if (real != null) return real;
  } catch {
    /* fallback to trades-based */
  }
  const trades = realTradesOnly(getTrades()).filter((t) => t.sellTimestamp);
  const totalPnl = trades.reduce((s, t) => s + t.pnlSol, 0);
  return chartStartBalanceSol() + totalPnl;
}

function realTradesOnly<T extends { mint: string }>(trades: T[]): T[] {
  return trades.filter((t) => !t.mint.startsWith("DemoMint"));
}

app.get("/api/trades", (_req, res) => {
  const trades = realTradesOnly(getTrades());
  res.json({ trades });
});

app.get("/api/trades/latest", (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 2000);
  const trades = realTradesOnly(getTrades()).slice(0, limit);
  res.json({ trades });
});

app.get("/api/balance", async (_req, res) => {
  const balance = await getBalance();
  maybeAppendBalanceSnapshot(balance);
  res.json({ balanceSol: balance });
});

app.get("/api/pnl", (_req, res) => {
  const trades = realTradesOnly(getTrades()).filter((t) => t.sellTimestamp);
  const totalPnlSol = trades.reduce((s, t) => s + t.pnlSol, 0);
  res.json({ totalPnlSol, tradeCount: trades.length });
});

/** Wallet balance over time: closed trades + persisted RPC snapshots (same DATA_DIR as bot). */
app.get("/api/balance/chart", async (_req, res) => {
  const trades = realTradesOnly(getTrades())
    .filter((t) => t.sellTimestamp && t.sellTimestamp.length > 0)
    .sort((a, b) => new Date(a.sellTimestamp!).getTime() - new Date(b.sellTimestamp!).getTime());
  const tradePoints: { timestamp: string; balanceSol: number }[] = [];
  const startBalance = chartStartBalanceSol();
  let balance = startBalance;
  if (trades.length > 0) {
    tradePoints.push({
      timestamp: trades[0]!.buyTimestamp,
      balanceSol: startBalance,
    });
  }
  for (const t of trades) {
    balance += t.pnlSol;
    tradePoints.push({ timestamp: t.sellTimestamp!, balanceSol: balance });
  }

  const snapshots = readBalanceSnapshots();
  let points = mergeBalanceChartPoints(tradePoints, snapshots);

  try {
    const { getWalletBalanceSol } = await import("clawdbot/agent");
    const real = await getWalletBalanceSol();
    if (real != null) {
      maybeAppendBalanceSnapshot(real);
      points.push({ timestamp: new Date().toISOString(), balanceSol: real });
    }
  } catch {
    /* no wallet linked */
  }

  points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const rawCount = points.length;
  const maxPts = Math.min(12_000, Math.max(400, Number(process.env.CHUD_CHART_MAX_POINTS) || 8000));
  if (points.length > maxPts) {
    const thin: typeof points = [];
    const n = points.length;
    const step = (n - 1) / (maxPts - 1);
    for (let i = 0; i < maxPts; i++) {
      thin.push(points[Math.round(i * step)]!);
    }
    points = thin;
  }

  const from = points[0]?.timestamp;
  const to = points[points.length - 1]?.timestamp;
  res.json({ points, meta: { from, to, count: points.length, rawCount } });
});

app.get("/api/chud/state", (_req, res) => {
  const state = getState();
  res.json(state ?? { kind: "idle", at: new Date().toISOString() });
});

app.get("/api/logs", (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 100, 300);
  const logs = getLogs().slice(0, limit);
  res.json({ logs });
});

app.get("/api/filters", (_req, res) => {
  const filters = getFilters();
  res.json(filters);
});

/** Debug: wallet connection status (helps diagnose balance/trading issues) */
app.get("/api/wallet-status", async (_req, res) => {
  try {
    const { getWalletBalanceWithError } = await import("clawdbot/agent");
    const { balance, error } = await getWalletBalanceWithError();
    const hasWallet = !!process.env.WALLET_PRIVATE_KEY?.trim();
    const hasRpc = !!process.env.SOLANA_RPC_URL?.trim();
    const tradingWalletPubkey =
      typeof getPublicKeyBase58 === "function" ? getPublicKeyBase58() : null;
    const expected = process.env.CHUD_WALLET_PUBLIC?.trim();
    const pubkeyMatchesExpected =
      !expected || !tradingWalletPubkey ? undefined : tradingWalletPubkey === expected;
    res.json({
      connected: balance != null,
      balanceSol: balance ?? null,
      tradingWalletPubkey,
      expectedWalletPubkey: expected || undefined,
      pubkeyMatchesExpected,
      hasWallet,
      hasRpc,
      error: error ?? undefined,
      hint:
        pubkeyMatchesExpected === false
          ? "Railway WALLET_PRIVATE_KEY pubkey does not match CHUD_WALLET_PUBLIC — update the secret to the keypair for your main wallet."
          : balance == null
            ? error
              ? error
              : !hasWallet
                ? "Set WALLET_PRIVATE_KEY in .env (or Railway Variables)"
                : !hasRpc
                  ? "Set SOLANA_RPC_URL in .env (or Railway Variables)"
                  : "RPC call failed"
            : undefined,
    });
  } catch (e) {
    res.json({
      connected: false,
      balanceSol: null,
      hasWallet: !!process.env.WALLET_PRIVATE_KEY?.trim(),
      hasRpc: !!process.env.SOLANA_RPC_URL?.trim(),
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

const CHUD_AGENT_BASE = process.env.CHUD_AGENT_BASE_URL?.trim() || "http://localhost:4000";

app.get("/api/agent/candidates", async (_req, res) => {
  try {
    const { getCandidates } = await import("clawdbot/agent");
    const candidates = await getCandidates();
    res.json({ candidates });
  } catch (e) {
    console.error("[Backend] Agent getCandidates error:", e);
    res.status(503).json({
      error: "Agent API unavailable. Build clawdbot and set DATA_DIR.",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.get("/api/agent/position", async (_req, res) => {
  try {
    const { getPositionWithQuote } = await import("clawdbot/agent");
    const position = await getPositionWithQuote();
    res.json(position);
  } catch (e) {
    console.error("[Backend] Agent getPosition error:", e);
    res.status(503).json({
      error: "Agent API unavailable. Build clawdbot and set DATA_DIR.",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/agent/buy", async (req, res) => {
  try {
    const { buy: agentBuy } = await import("clawdbot/agent");
    const parsed = sanitizeAgentBuyBody(req.body);
    if ("error" in parsed) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }
    const result = await agentBuy(parsed);
    res.json(result);
  } catch (e) {
    console.error("[Backend] Agent buy error:", e);
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

app.post("/api/agent/sell", async (req, res) => {
  try {
    const { sell: agentSell } = await import("clawdbot/agent");
    const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
    const result = await agentSell({ reason });
    res.json(result);
  } catch (e) {
    console.error("[Backend] Agent sell error:", e);
    res.status(500).json({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
});

/** Mark open trade closed in Chud data **without** PumpPortal (stuck sell / graduated token). Requires secret. */
app.post("/api/agent/force-close", async (req, res) => {
  try {
    const secret = process.env.CHUD_FORCE_CLOSE_SECRET?.trim();
    if (!secret) {
      return res.status(503).json({
        ok: false,
        error: "Set CHUD_FORCE_CLOSE_SECRET in .env to enable POST /api/agent/force-close",
      });
    }
    const got = String(req.headers["x-chud-force-close"] ?? req.body?.secret ?? "").trim();
    if (got !== secret) {
      return res.status(403).json({ ok: false, error: "Invalid or missing secret (header X-Chud-Force-Close or body.secret)" });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "force close";
    const { forceClosePosition } = await import("clawdbot/agent");
    const result = await forceClosePosition({ reason });
    res.json(result);
  } catch (e) {
    console.error("[Backend] Agent force-close error:", e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/agent/trading-paused", async (_req, res) => {
  try {
    const { getTradingPauseState } = await import("clawdbot/agent");
    res.json(getTradingPauseState());
  } catch (e) {
    console.error("[Backend] trading-paused GET error:", e);
    res.status(503).json({ error: "Unavailable. Build clawdbot.", detail: String(e) });
  }
});

app.post("/api/agent/trading-paused", express.json(), async (req, res) => {
  try {
    const secret =
      process.env.CHUD_TRADING_PAUSE_SECRET?.trim() || process.env.CHUD_FORCE_CLOSE_SECRET?.trim();
    if (!secret) {
      return res.status(503).json({
        ok: false,
        error:
          "Set CHUD_TRADING_PAUSE_SECRET or CHUD_FORCE_CLOSE_SECRET to enable POST /api/agent/trading-paused",
      });
    }
    const got = String(req.headers["x-chud-trading-pause"] ?? req.body?.secret ?? "").trim();
    if (got !== secret) {
      return res.status(403).json({
        ok: false,
        error: "Invalid or missing secret (header X-Chud-Trading-Pause or body.secret)",
      });
    }
    if (typeof req.body?.paused !== "boolean") {
      return res.status(400).json({ ok: false, error: 'JSON body must include "paused": true or false' });
    }
    const { setTradingPausedFile, getTradingPauseState } = await import("clawdbot/agent");
    setTradingPausedFile(req.body.paused);
    res.json({ ok: true, ...getTradingPauseState() });
  } catch (e) {
    console.error("[Backend] trading-paused POST error:", e);
    res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

app.get("/api/coach/messages", async (_req, res) => {
  try {
    const { getCoachMessages } = await import("clawdbot/coach-notes");
    res.json({ messages: getCoachMessages(100) });
  } catch (e) {
    console.error("[Backend] coach messages error:", e);
    res.status(503).json({ error: "Coach API unavailable. Build clawdbot.", detail: String(e) });
  }
});

app.post("/api/coach/messages", async (req, res) => {
  try {
    const { appendCoachMessage } = await import("clawdbot/coach-notes");
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const msg = appendCoachMessage(text);
    res.json({ ok: true, message: msg });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(400).json({ ok: false, error: msg });
  }
});

app.get("/api/chat/messages", async (req, res) => {
  try {
    const { getChudChatMessages, chudChatLlmConfigured, normalizeChudChatSessionId } = await import("clawdbot/chud-chat");
    const h = req.headers["x-chud-chat-session"];
    const raw = Array.isArray(h) ? h[0] : h;
    const sessionId = normalizeChudChatSessionId(raw);
    res.json({ messages: getChudChatMessages(100, sessionId), llmConfigured: chudChatLlmConfigured() });
  } catch (e) {
    console.error("[Backend] chat messages error:", e);
    res.status(503).json({ error: "Chat unavailable. Build clawdbot.", detail: String(e) });
  }
});

app.post("/api/chat/messages", async (req, res) => {
  try {
    const { sendChudChatUserMessage, normalizeChudChatSessionId } = await import("clawdbot/chud-chat");
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    const alsoCoachNote = req.body?.alsoCoachNote === true;
    const h = req.headers["x-chud-chat-session"];
    const fromHeader = Array.isArray(h) ? h[0] : h;
    const fromBody = typeof req.body?.sessionId === "string" ? req.body.sessionId : undefined;
    const sessionId = normalizeChudChatSessionId(fromHeader ?? fromBody);
    const out = await sendChudChatUserMessage(text, { alsoCoachNote, sessionId });
    res.json({ ok: true, user: out.user, assistant: out.assistant });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("No ANTHROPIC") || msg.includes("No LLM") ? 503 : 400;
    res.status(code).json({ ok: false, error: msg });
  }
});

app.post("/api/chat/clear", async (req, res) => {
  try {
    const { clearChudChat, normalizeChudChatSessionId } = await import("clawdbot/chud-chat");
    const h = req.headers["x-chud-chat-session"];
    const raw = Array.isArray(h) ? h[0] : h;
    const sessionId = normalizeChudChatSessionId(raw);
    clearChudChat(sessionId);
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e) });
  }
});

app.get("/api/chud/outbox", async (_req, res) => {
  try {
    const o = readChudOutbox();
    if (!o) {
      return res.json({
        text: null,
        at: null,
        hint: "nothing yet — set CHUD_THOUGHT_POST_MINUTES in .env and wait one cycle",
      });
    }
    res.json(o);
  } catch (e) {
    res.status(503).json({ error: "outbox unavailable", detail: String(e) });
  }
});

app.post("/api/chud/outbox", async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      return res.status(400).json({ ok: false, error: "JSON body { \"text\": \"...\" } required" });
    }
    writeChudOutbox(text);
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e) });
  }
});

app.get("/api/agent/info", (_req, res) => {
  const pumpKey =
    (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim().length > 0;
  const pumpPortalKeyOnTradeLocal =
    pumpKey &&
    (process.env.PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL === "1" ||
      process.env.PUMPPORTAL_USE_KEY_ON_TRADE_LOCAL === "1");
  const solanaRpcSet = !!process.env.SOLANA_RPC_URL?.trim();
  const walletPrivateKeySet = !!process.env.WALLET_PRIVATE_KEY?.trim();
  res.json({
    message:
      "Chud agent API. GET candidates, position. POST buy / sell. POST force-close (CHUD_FORCE_CLOSE_SECRET). GET/POST trading-paused (secret: CHUD_TRADING_PAUSE_SECRET or same as force-close). Buys retry pools (CHUD_BUY_POOL_FALLBACKS); sells retry (CHUD_SELL_POOL_FALLBACKS). Trade-local calls omit ?api-key= by default (Lightning keys + external wallet → HTTP 400); set PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL=1 only if Portal gave you a local-compatible key.",
    baseUrl: CHUD_AGENT_BASE,
    pumpPortalApiKeySet: pumpKey,
    pumpPortalKeyOnTradeLocal,
    solanaRpcSet,
    walletPrivateKeySet,
    endpoints: {
      candidates: `${CHUD_AGENT_BASE}/api/agent/candidates`,
      position: `${CHUD_AGENT_BASE}/api/agent/position`,
      buy: `${CHUD_AGENT_BASE}/api/agent/buy`,
      sell: `${CHUD_AGENT_BASE}/api/agent/sell`,
      forceClose: `${CHUD_AGENT_BASE}/api/agent/force-close`,
      tradingPaused: `${CHUD_AGENT_BASE}/api/agent/trading-paused`,
      chudOutbox: `${CHUD_AGENT_BASE}/api/chud/outbox`,
    },
  });
});

// Serve static web build in production
if (isProd) {
  const webDist = join(process.cwd(), "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (_req, res) => res.sendFile(join(webDist, "index.html")));
  }
}

// Run clawdbot trading loop in same process so wallet/env are shared
import("clawdbot").catch((e) => console.error("[Backend] Clawdbot import failed:", e));

app.listen(PORT, "0.0.0.0", () => {
  const pumpKey =
    (process.env.PUMPPORTAL_API_KEY || process.env.PUMP_FUN_API_KEY || "").trim().length > 0;
  const pumpOnLocal =
    pumpKey &&
    (process.env.PUMPPORTAL_APPEND_KEY_TO_TRADE_LOCAL === "1" ||
      process.env.PUMPPORTAL_USE_KEY_ON_TRADE_LOCAL === "1");
  const rpc = !!process.env.SOLANA_RPC_URL?.trim();
  const wallet = !!process.env.WALLET_PRIVATE_KEY?.trim();
  console.log(`[Backend] API on http://0.0.0.0:${PORT}${isProd ? " (serving web)" : ""}`);
  console.log(
    `[Backend] Swaps: SOLANA_RPC_URL=${rpc ? "set" : "MISSING"} WALLET_PRIVATE_KEY=${wallet ? "set" : "MISSING"} PUMPPORTAL key in env=${pumpKey ? "yes" : "no"} append-to-trade-local=${pumpOnLocal ? "yes" : "no (default)"}`
  );

  import("clawdbot/config")
    .then(({ getDataDir }) => {
      console.log(`[Backend] DATA_DIR (clawdbot getDataDir): ${getDataDir()}`);
    })
    .catch(() => {});

  const snapshotTick = () => {
    getBalance()
      .then((b) => maybeAppendBalanceSnapshot(b))
      .catch(() => {});
  };
  setTimeout(snapshotTick, 4000);
  setInterval(snapshotTick, 120_000);
});
