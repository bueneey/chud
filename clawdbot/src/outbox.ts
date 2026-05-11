/**
 * Latest Chud “thought” line for OpenClaw / scripts to pick up (no X API needed).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./config.js";

const FILE = "chud-outbox.json";

export type ChudOutbox = { text: string; at: string };

export const writeChudOutbox = (text: string): void => {
  const payload: ChudOutbox = { text: text.trim(), at: new Date().toISOString() };
  writeFileSync(join(getDataDir(), FILE), JSON.stringify(payload, null, 0), "utf-8");
};

export function readChudOutbox(): ChudOutbox | null {
  const p = join(getDataDir(), FILE);
  if (!existsSync(p)) return null;
  try {
    const o = JSON.parse(readFileSync(p, "utf-8")) as ChudOutbox;
    if (typeof o?.text === "string" && typeof o?.at === "string") return o;
    return null;
  } catch {
    return null;
  }
}
