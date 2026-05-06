/**
 * Chud narrative buy + sell decisions via LLM.
 * Backends: Anthropic, OpenAI, Gemini, Ollama (see env.example).
 * CHUD_LLM_PROVIDER=ollama prefers local Ollama even if cloud keys exist.
 */
import type { CandidateCoin } from "./types.js";
import { getCoachContextForPrompt } from "./coach-notes.js";
import { geminiComplete, hasGeminiKey } from "./gemini.js";
import { ollamaComplete, hasOllama } from "./ollama.js";
import { anyChudLlmConfigured, chudLlmBackendOrder } from "./llm-provider-order.js";

export interface PositionQuote {
  unrealizedPnlPercent: number | null;
  unrealizedPnlSol: number | null;
  holdSeconds: number;
  buyPriceUsd: number | null;
  currentPriceUsd: number | null;
}

function anthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5";
}

function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function hasKeys(): boolean {
  return anyChudLlmConfigured();
}

async function anthropicComplete(prompt: string, maxTokens: number): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY!;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: anthropicModel(),
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.warn("[Chud/LLM] Anthropic error:", res.status, await res.text().catch(() => ""));
    return "";
  }
  const data = (await res.json()) as { content?: { text?: string }[] };
  return data.content?.[0]?.text ?? "";
}

async function openaiComplete(prompt: string, maxTokens: number, jsonObject = false): Promise<string> {
  const key = process.env.OPENAI_API_KEY!;
  const body: Record<string, unknown> = {
    model: openaiModel(),
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (jsonObject) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.warn("[Chud/LLM] OpenAI error:", res.status, await res.text().catch(() => ""));
    return "";
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

const PICK_JSON_SUFFIX = '\nRespond with JSON only shaped as {"pick":number,"why":string}.';

async function completePick(prompt: string, maxTokens: number): Promise<string> {
  for (const p of chudLlmBackendOrder()) {
    if (p === "anthropic" && process.env.ANTHROPIC_API_KEY?.trim()) {
      return anthropicComplete(prompt, maxTokens);
    }
    if (p === "openai" && process.env.OPENAI_API_KEY?.trim()) {
      return openaiComplete(prompt + PICK_JSON_SUFFIX, maxTokens, true);
    }
    if (p === "gemini" && hasGeminiKey()) {
      return geminiComplete(prompt + PICK_JSON_SUFFIX, maxTokens);
    }
    if (p === "ollama" && hasOllama()) {
      return ollamaComplete(prompt + PICK_JSON_SUFFIX, maxTokens);
    }
  }
  return "";
}

async function completePlain(prompt: string, maxTokens: number): Promise<string> {
  for (const p of chudLlmBackendOrder()) {
    if (p === "anthropic" && process.env.ANTHROPIC_API_KEY?.trim()) {
      return anthropicComplete(prompt, maxTokens);
    }
    if (p === "openai" && process.env.OPENAI_API_KEY?.trim()) {
      return openaiComplete(prompt, maxTokens, false);
    }
    if (p === "gemini" && hasGeminiKey()) {
      return geminiComplete(prompt, maxTokens);
    }
    if (p === "ollama" && hasOllama()) {
      return ollamaComplete(prompt, maxTokens);
    }
  }
  return "";
}

function parsePickJson(text: string): { index: number; narrative: string } | null {
  const trimmed = text.trim();
  const m = trimmed.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { pick?: unknown; why?: unknown };
    const pick = typeof o.pick === "number" ? o.pick : Number(o.pick);
    if (!Number.isFinite(pick) || pick < 0) return null;
    const why = typeof o.why === "string" ? o.why.trim() : "";
    return { index: Math.floor(pick), narrative: why || "(no reason given)" };
  } catch {
    return null;
  }
}

/**
 * Chud picks one candidate from the list using narrative / vibe (not random).
 * Returns null if LLM unavailable or parse fails.
 */
export async function askChudPickCandidate(candidates: CandidateCoin[]): Promise<{ index: number; narrative: string } | null> {
  if (!hasKeys() || candidates.length === 0) return null;
  if (candidates.length === 1) return { index: 0, narrative: candidates[0]!.reason };

  const slice = candidates.slice(0, 10);
  const list = slice
    .map((c, i) => {
      const bits = [
        `${i}. $${c.symbol} — ${c.name}`,
        `   ${c.reason}`,
        c.twitter ? `   X: ${c.twitter}` : "",
        c.website ? `   web: ${c.website}` : "",
        c.holderInfo ? `   holders: ${c.holderInfo}` : "",
        c.mcapUsd != null ? `   mcap ~$${(c.mcapUsd / 1000).toFixed(1)}k` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return bits;
    })
    .join("\n\n");

  const coach = getCoachContextForPrompt();
  const coachBlock = coach
    ? `FROM YOUR CREATOR (human notes—guidance and trading taste, not literal orders; you still choose the ticker):\n${coach}\n\n`
    : "";

  const prompt = `You are **Chud the Trader**: a Solana memecoin degen with no formal training—only narrative instinct, ticker comedy, gut, and whether something smells like lore or rug vapor.

${coachBlock}You must pick **exactly one** coin to ape from this filtered list (the system already applied mcap/volume/age limits):

${list}

Reply with **only** valid JSON on one line (no markdown fences):
{"pick":<0-based index 0..${slice.length - 1}>,"why":"<2-5 sentences: what story you see, why this ticker, what you are ignoring on purpose, acceptable cope>"}`;

  const text = await completePick(prompt, 400);

  const parsed = parsePickJson(text);
  if (!parsed || parsed.index < 0 || parsed.index >= slice.length) {
    console.warn("[Chud/LLM] Bad pick JSON, falling back:", text.slice(0, 120));
    return null;
  }
  return parsed;
}

/**
 * Chud decides whether to sell from narrative + tape + recent closed trades (no fixed TP/SL in prompt).
 */
export async function askChudShouldSell(
  symbol: string,
  whyBought: string,
  quote: PositionQuote,
  recentTradesSummary: string
): Promise<{ shouldSell: boolean; reason?: string }> {
  if (!hasKeys()) {
    return { shouldSell: false };
  }

  const pnl = quote.unrealizedPnlPercent ?? 0;
  const pnlSol = quote.unrealizedPnlSol ?? 0;
  const holdMin = Math.floor((quote.holdSeconds ?? 0) / 60);
  const holdSec = quote.holdSeconds ?? 0;
  const px = quote.currentPriceUsd != null ? `$${quote.currentPriceUsd.toFixed(8)}` : "unknown";

  const coach = getCoachContextForPrompt();
  const coachBlock = coach
    ? `FROM YOUR CREATOR (human notes—risk prefs, what to stop repeating; you still decide SELL vs HOLD):\n${coach}\n\n`
    : "";

  const prompt = `You are **Chud the Trader**—autonomous, unserious, but trying to *read* the tape like a person. You hold $${symbol}.

${coachBlock}WHY YOU BOUGHT (your past self’s note):
${whyBought.slice(0, 900)}

CURRENT TAPE:
- Unrealized PnL: ${pnl.toFixed(1)}% (~${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL notional)
- Held: ${holdMin}m (${holdSec}s)
- Last price (rough USD/token): ${px}

YOUR MEMORY — last closed rounds (learn from wins/losses, do not repeat the same cope blindly):
${recentTradesSummary.slice(0, 1200)}

There is **no** automatic rule like “always take +20%” or “always cut at -30%”. You judge: Is the narrative still alive? Is this distribution / momentum telling a story you still believe? Are you holding from ego? Would *selling now* be the smart chud move—or diamond hands delusion?

Reply starting with exactly **SELL** or **HOLD** on the first line.
If **SELL**, add a comma then a vivid, honest reason (narrative + what changed in your read). If **HOLD**, you may add a comma then one sentence on what you are waiting to see next.`;

  try {
    const text = await completePlain(prompt, 400);
    const upper = text.toUpperCase().trim();
    const shouldSell = upper.startsWith("SELL");
    const reason =
      text.includes(",") && shouldSell ? text.split(",").slice(1).join(",").trim() : shouldSell ? text.replace(/^SELL\s*/i, "").trim() : undefined;
    return { shouldSell, reason: reason || undefined };
  } catch (e) {
    console.warn("[Chud/LLM] sell decision error:", e);
    return { shouldSell: false };
  }
}

/** One short “thinking out loud” line (timer → outbox / optional X). */
export async function askChudThoughtTweet(context: string): Promise<string | null> {
  if (!hasKeys()) return null;
  const coach = getCoachContextForPrompt(600);
  const coachBit = coach ? `\n(vibe hints from creator, not orders)\n${coach}\n` : "";
  const prompt = `You are **Chud** — solana memecoin degen narrator: ironic, self-aware, cope-as-joke, quick-flip brain (scalps and small wins) but honest when a runner might still have legs. NOT corporate. mild swearing allowed. NOT slurs. NOT punching down.

This line is a **session check-in** for X: how trading feels right now (bag, flat, pnl, boredom, hype, regret, tiny win energy).

Hard rules for your output:
- ALL LOWERCASE letters only (numbers and punctuation ok).
- ONE status line only. target ~120–200 characters (never over 240).
- no hashtags spam, no "tweet:", no quotes wrapping the whole thing.
- first person. mention real tape from snapshot (pnl, flat, hold time, last flips) — not generic "markets are volatile".${coachBit}

snapshot:
${context.slice(0, 1200)}`;

  const text = await completePlain(prompt, 200);
  let t = text.replace(/^["']|["']$/g, "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!t) return null;
  if (t.length > 240) t = t.slice(0, 237) + "…";
  return t;
}

/** @deprecated name — same as askChudShouldSell without learning block (avoid). */
export async function askLobbiShouldSell(
  symbol: string,
  whyBought: string,
  quote: PositionQuote
): Promise<{ shouldSell: boolean; reason?: string }> {
  return askChudShouldSell(symbol, whyBought, quote, "(no trade history passed)");
}
