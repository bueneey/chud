/**
 * Every CHUD_THOUGHT_POST_MINUTES: Claude writes one short chud-voice line from live tape.
 * Always saved to data/chud-outbox.json — OpenClaw (or you) can GET /api/chud/outbox and post via browser / Telegram.
 * If X is configured (API / intent / playwright), also fires there.
 */
import { getPositionWithQuote } from "./agent-api.js";
import { getRecentClosedTradesSummary, getTrades } from "./storage.js";
import { askChudThoughtTweet } from "./llm.js";
import { postChudCustomTweet, isXPostingConfigured } from "./x-post.js";
import { writeChudOutbox } from "./outbox.js";
import { anyChudLlmConfigured } from "./llm-provider-order.js";

let started = false;

export function maybeStartThoughtPosting(): void {
  if (started) return;
  const mins = Number(process.env.CHUD_THOUGHT_POST_MINUTES || "0");
  if (!Number.isFinite(mins) || mins <= 0) return;
  if (!anyChudLlmConfigured()) {
    console.log(
      "[Chud] CHUD_THOUGHT_POST_MINUTES needs an LLM (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or OLLAMA_MODEL) — skipping thought timer."
    );
    return;
  }
  started = true;
  const ms = Math.max(1, mins) * 60 * 1000;
  const x = isXPostingConfigured();
  const skipTrade = process.env.CHUD_X_SKIP_TRADE_TWEETS === "1" || process.env.CHUD_X_SKIP_TRADE_TWEETS === "true";
  console.log(
    `[Chud] Thought line every ${mins}m → data/chud-outbox.json + GET /api/chud/outbox` +
      (x ? " (also posting recap to X)" : " (X off — use OpenClaw + browser on outbox text)") +
      (skipTrade ? " · buy/sell X posts OFF (CHUD_X_SKIP_TRADE_TWEETS)" : "")
  );
  if (process.env.ANTHROPIC_API_KEY?.trim() && mins < 15) {
    console.warn(
      "[Chud] CHUD_THOUGHT_POST_MINUTES under 15m with Anthropic adds many LLM calls/day. Try 30–60 or unset to save spend."
    );
  }
  setInterval(() => {
    void tick();
  }, ms);
}

async function tick(): Promise<void> {
  try {
    const pos = await getPositionWithQuote();
    const open = pos.openTrade;
    const memory = getRecentClosedTradesSummary(5);
    const closed = getTrades().filter((t) => t.sellTimestamp && t.sellTimestamp !== "").slice(0, 3);
    const pnlBits = closed
      .map((t) => `$${t.symbol}: ${t.pnlSol >= 0 ? "+" : ""}${t.pnlSol.toFixed(4)} sol`)
      .join("; ");
    let block: string;
    if (open && pos.quote) {
      const why = open.why ?? "";
      const pnl = pos.quote.unrealizedPnlPercent;
      const pnlSol = pos.quote.unrealizedPnlSol;
      const hm = Math.floor((pos.quote.holdSeconds ?? 0) / 60);
      block = `holding $${open.symbol}. vibe: ${why.slice(0, 120)}. ${hm}m in bag. last exits: ${pnlBits || "none"}`;
    } else {
      block = `flat, no bag. last exits: ${pnlBits || memory.slice(0, 200) || "none"}`;
    }
    const line = await askChudThoughtTweet(block);
    if (!line) return;
    writeChudOutbox(line);
    if (isXPostingConfigured()) {
      postChudCustomTweet(line);
    }
    console.log("[Chud] outbox:", line.slice(0, 100) + (line.length > 100 ? "…" : ""));
  } catch (e) {
    console.warn("[Chud] thought tick error:", e);
  }
}
