/**
 * Stop / start new trading without redeploy.
 *
 * - **Env:** `CHUD_TRADING_PAUSED=1` or `true` → always paused until you change env and restart.
 * - **File:** `data/trading-paused.json` with `{ "paused": true }` → paused; removed when unpaused via API.
 *   Combined: paused if env says so **or** file says so.
 *
 * While paused: **no new buys** (autonomous scan + `POST /api/agent/buy`). **Sells still work** (exit a bag).
 * If you hold a position, the autonomous loop still runs **hold/sell** so you are not stuck.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.js";

const FILE = "trading-paused.json";

function pauseFromEnv(): boolean {
  const v = (process.env.CHUD_TRADING_PAUSED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function pauseFileFullPath(): string {
  return join(getDataDir(), FILE);
}

function pauseFromFile(): boolean {
  const p = pauseFileFullPath();
  if (!existsSync(p)) return false;
  try {
    const o = JSON.parse(readFileSync(p, "utf-8")) as { paused?: boolean };
    return o?.paused === true;
  } catch {
    return false;
  }
}

export function isTradingPaused(): boolean {
  return pauseFromEnv() || pauseFromFile();
}

export function getTradingPauseState(): { paused: boolean; fromEnv: boolean; fromFile: boolean } {
  const fromEnv = pauseFromEnv();
  const fromFile = pauseFromFile();
  return { paused: fromEnv || fromFile, fromEnv, fromFile };
}

/** Runtime toggle (used by HTTP). Does not clear env-based pause. */
export function setTradingPausedFile(paused: boolean): void {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, FILE);
  if (!paused) {
    if (existsSync(p)) unlinkSync(p);
    return;
  }
  writeFileSync(p, JSON.stringify({ paused: true, at: new Date().toISOString() }, null, 0), "utf-8");
}
