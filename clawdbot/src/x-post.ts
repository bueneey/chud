/**
 * X (Twitter) posts for Chud — pick one path:
 * - **API**: TWITTER_* OAuth 1.0a keys (developer portal).
 * - **No API / “desktop”**: `CHUD_X_POST_MODE=intent` opens your default browser to a pre-filled compose URL (you stay logged in in the browser; one click to Post if X asks).
 * - **No API / full auto (local only)**: `CHUD_X_POST_MODE=playwright` + `npm i playwright` + saved storage state (see env.example).
 * TWITTER_DISABLED=1 disables all paths.
 */
import { createHmac, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.js";
import { writeChudOutbox } from "./outbox.js";

const TWEET_MAX = 280;

function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function safeSym(symbol: string): string {
  return symbol.replace(/[$\s]/g, "").slice(0, 14) || "???";
}

function truncate(text: string, max = TWEET_MAX): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function buyLines(sym: string, sol?: number): string[] {
  const s = sol != null ? ` (~${sol.toFixed(3)} SOL in)` : "";
  return [
    `chud aped $${sym}${s}. no thesis. no mentor. pure primate markets 🫡`,
    `$${sym} — “due diligence” was staring at the chart for 4 seconds. we move`,
    `bought $${sym}. statistically this could be wrong. statistically we do not care`,
    `chud opened $${sym}. 1 SOL life. zero curriculum. maximum field research`,
    `$${sym} is now in the portfolio. the portfolio is mostly vibes and cope`,
    `new bag: $${sym}. if it rugs we call it “tuition” and keep it pushing`,
  ].map((t) => truncate(t));
}

function sellLines(sym: string, pnlStr: string, reason?: string): string[] {
  const r = reason ? ` (${reason.slice(0, 80)})` : "";
  const base = [
    `sold $${sym}. pnl ${pnlStr}.${r} emotionally? it’s complicated`,
    `exited $${sym} for ${pnlStr}.${r} harvard business review on line 1 📞`,
    `closed $${sym} → ${pnlStr}.${r} chud university semester complete`,
    `$${sym} round over. ${pnlStr}.${r} back to staring at new charts`,
  ].map((t) => truncate(t));
  return base;
}

function hasTwitterOAuth(): boolean {
  return !!(
    process.env.TWITTER_API_KEY &&
    process.env.TWITTER_API_SECRET &&
    process.env.TWITTER_ACCESS_TOKEN &&
    process.env.TWITTER_ACCESS_TOKEN_SECRET
  );
}

export type XPostChannel = "api" | "intent" | "playwright";

function resolveXPostChannel(): XPostChannel | null {
  if (process.env.TWITTER_DISABLED === "1") return null;
  const mode = (process.env.CHUD_X_POST_MODE || "").trim().toLowerCase();
  if (mode === "off" || mode === "none" || mode === "disabled") return null;
  if (mode === "intent" || mode === "browser" || mode === "open") return "intent";
  if (mode === "playwright" || mode === "desktop") return "playwright";
  if (mode === "api") return hasTwitterOAuth() ? "api" : null;
  if (hasTwitterOAuth()) return "api";
  return null;
}

export function isXPostingConfigured(): boolean {
  return resolveXPostChannel() != null;
}

/** When 1, skip buy/sell announcement tweets — only timer / custom lines (e.g. CHUD_THOUGHT_POST_MINUTES) hit X. */
export function isTradeEventXTweetingEnabled(): boolean {
  if (process.env.TWITTER_DISABLED === "1") return false;
  if (process.env.CHUD_X_SKIP_TRADE_TWEETS === "1" || process.env.CHUD_X_SKIP_TRADE_TWEETS === "true") {
    return false;
  }
  return resolveXPostChannel() != null;
}

export function describeXPosting(): string {
  const c = resolveXPostChannel();
  const ob = tradeOutboxEnabled() ? " + trade lines → /api/chud/outbox" : "";
  if (c === "api") return "X API (OAuth)" + ob;
  if (c === "intent") return "browser compose URLs (no X API — opens default browser)" + ob;
  if (c === "playwright") return "Playwright headless (saved login — no X API)" + ob;
  return "off (trade copy still → outbox if enabled)" + ob;
}

/** Every buy/sell writes tweet-sized text to chud-outbox.json for the site + OpenClaw (no X API needed). Set CHUD_TRADE_OUTBOX=0 to disable. */
function tradeOutboxEnabled(): boolean {
  return process.env.CHUD_TRADE_OUTBOX !== "0" && process.env.CHUD_TRADE_OUTBOX !== "false";
}

function pushTradeOutbox(prefix: "[buy]" | "[sell]", text: string): void {
  if (!tradeOutboxEnabled()) return;
  try {
    writeChudOutbox(`${prefix} ${text}`);
  } catch (e) {
    console.warn("[Chud/X] outbox write failed:", e);
  }
}

function openBrowserUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const opts = { windowsHide: true as const };
    if (process.platform === "darwin") {
      execFile("open", [url], opts, (err) => (err ? reject(err) : resolve()));
    } else if (process.platform === "win32") {
      execFile("cmd", ["/c", "start", "", url], opts, (err) => (err ? reject(err) : resolve()));
    } else {
      execFile("xdg-open", [url], opts, (err) => (err ? reject(err) : resolve()));
    }
  });
}

/** Pre-filled compose in your default browser (uses your existing X session). */
async function postIntentTweet(text: string): Promise<void> {
  const t = truncate(text, TWEET_MAX);
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(t)}`;
  await openBrowserUrl(url);
  console.log("[Chud/X] Opened compose in browser (intent).");
}

type PlaywrightChromium = {
  launch: (opts: { headless: boolean }) => Promise<{
    newContext: (o: { storageState: string }) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, o?: object) => Promise<unknown>;
        close: () => Promise<unknown>;
        locator: (sel: string) => {
          first: () => {
            waitFor: (o: object) => Promise<unknown>;
            click: (o?: object) => Promise<unknown>;
          };
        };
      }>;
      close: () => Promise<unknown>;
    }>;
    close: () => Promise<unknown>;
  }>;
};

async function loadPlaywrightChromium(): Promise<PlaywrightChromium | null> {
  try {
    const dynamicImport = new Function("s", "return import(s)") as (s: string) => Promise<{ chromium: PlaywrightChromium }>;
    const { chromium } = await dynamicImport("playwright");
    return chromium ?? null;
  } catch {
    return null;
  }
}

async function postViaPlaywright(text: string): Promise<void> {
  const chromium = await loadPlaywrightChromium();
  if (!chromium) {
    console.warn(
      "[Chud/X] Playwright not installed. In clawdbot: npm i playwright && npx playwright install chromium"
    );
    return;
  }
  const storagePath =
    process.env.CHUD_X_PLAYWRIGHT_STORAGE_STATE?.trim() || join(getDataDir(), "x-playwright-storage.json");
  if (!existsSync(storagePath)) {
    console.warn(
      "[Chud/X] Playwright: missing storage state file:",
      storagePath,
      "— log in once with `npx playwright codegen https://x.com` and save storage to that path."
    );
    return;
  }
  const t = truncate(text, TWEET_MAX);
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(t)}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ storageState: storagePath });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    const btn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
    await btn.waitFor({ state: "visible", timeout: 20000 }).catch(() => undefined);
    await btn.click({ timeout: 8000 }).catch((e: unknown) => console.warn("[Chud/X] Playwright post click:", e));
    await new Promise((r) => setTimeout(r, 2500));
    await context.close().catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
  }
  console.log("[Chud/X] Playwright compose flow finished.");
}

async function postTweetV2(text: string): Promise<void> {
  const url = "https://api.twitter.com/2/tweets";
  const method = "POST";
  const consumerKey = process.env.TWITTER_API_KEY!;
  const consumerSecret = process.env.TWITTER_API_SECRET!;
  const token = process.env.TWITTER_ACCESS_TOKEN!;
  const tokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET!;

  const oauth_nonce = randomBytes(16).toString("hex");
  const oauth_timestamp = String(Math.floor(Date.now() / 1000));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp,
    oauth_token: token,
    oauth_version: "1.0",
  };

  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k]!)}`)
    .join("&");

  const baseString = [method, percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const oauth_signature = createHmac("sha1", signingKey).update(baseString).digest("base64");

  const headerParams = { ...oauthParams, oauth_signature };
  const authHeader =
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k as keyof typeof headerParams]!)}"`)
      .join(", ");

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text: truncate(text) }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[Chud/X] Tweet failed:", res.status, errBody.slice(0, 200));
  } else {
    console.log("[Chud/X] Posted:", truncate(text).slice(0, 80) + (text.length > 80 ? "…" : ""));
  }
}

export function postChudCustomTweet(text: string): void {
  if (!isXPostingConfigured()) return;
  dispatchPost(truncate(text.trim(), TWEET_MAX));
}

function dispatchPost(text: string): void {
  const ch = resolveXPostChannel();
  if (!ch) return;
  if (ch === "api") {
    void postTweetV2(text).catch((e) => console.warn("[Chud/X] API post error:", e));
    return;
  }
  if (ch === "intent") {
    void postIntentTweet(text).catch((e) => console.warn("[Chud/X] intent URL error:", e));
    return;
  }
  void postViaPlaywright(text).catch((e) => console.warn("[Chud/X] Playwright error:", e));
}

/** Prefer agent/OpenClaw narrative when long enough; else canned line. */
function buyTweetText(symbol: string, solAmount: number | undefined, agentReason: string | undefined): string {
  const sym = safeSym(symbol);
  const r = agentReason?.trim() ?? "";
  const s = solAmount != null ? ` ~${solAmount.toFixed(3)} sol` : "";
  if (r.length >= 14) {
    return truncate(`chud · $${sym}${s} — ${r}`, TWEET_MAX);
  }
  return pick(buyLines(sym, solAmount));
}

/** Prefer full sell reason (OpenClaw) in one tweet; else canned line. */
function sellTweetText(symbol: string, pnlSol: number, reason: string | undefined): string {
  const sym = safeSym(symbol);
  const sign = pnlSol >= 0 ? "+" : "";
  const pnlStr = `${sign}${pnlSol.toFixed(4)} sol`;
  const r = reason?.trim() ?? "";
  if (r.length >= 14 && r !== "Agent exit") {
    return truncate(`chud · sold $${sym} · ${pnlStr} — ${r}`, TWEET_MAX);
  }
  return pick(sellLines(sym, pnlStr, reason));
}

/** Fire-and-forget buy announcement */
export function postChudTweetBuy(symbol: string, solAmount?: number, agentReason?: string): void {
  const text = buyTweetText(symbol, solAmount, agentReason);
  pushTradeOutbox("[buy]", text);
  if (!isTradeEventXTweetingEnabled()) return;
  dispatchPost(text);
}

/** Fire-and-forget sell / PnL line */
export function postChudTweetSell(symbol: string, pnlSol: number, reason?: string): void {
  const text = sellTweetText(symbol, pnlSol, reason);
  pushTradeOutbox("[sell]", text);
  if (!isTradeEventXTweetingEnabled()) return;
  dispatchPost(text);
}
