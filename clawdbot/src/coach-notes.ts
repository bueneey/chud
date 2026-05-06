import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getDataDir } from "./config.js";

const FILENAME = "coach-messages.json";
const MAX_STORED = 200;
const MAX_PER_MESSAGE = 2000;

export interface CoachMessage {
  id: string;
  at: string;
  text: string;
}

function path(): string {
  return join(getDataDir(), FILENAME);
}

function readAll(): CoachMessage[] {
  const p = path();
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    return Array.isArray(arr) ? (arr as CoachMessage[]) : [];
  } catch {
    return [];
  }
}

function writeAll(messages: CoachMessage[]): void {
  writeFileSync(path(), JSON.stringify(messages), "utf-8");
}

export function getCoachMessages(limit = 100): CoachMessage[] {
  const all = readAll();
  return all.slice(-Math.min(limit, 500));
}

export function appendCoachMessage(text: string): CoachMessage {
  const trimmed = text.trim().slice(0, MAX_PER_MESSAGE);
  if (!trimmed) {
    throw new Error("empty message");
  }
  const msg: CoachMessage = { id: randomUUID(), at: new Date().toISOString(), text: trimmed };
  let all = readAll();
  all.push(msg);
  if (all.length > MAX_STORED) {
    all = all.slice(-MAX_STORED);
  }
  writeAll(all);
  return msg;
}

/** Chronological lines for LLM system context (newest still bounded by maxChars). */
export function getCoachContextForPrompt(maxChars = 2800): string {
  const all = readAll();
  if (all.length === 0) return "";
  const lines: string[] = [];
  let used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i]!;
    const line = `[${m.at}] ${m.text}`;
    if (used + line.length + 1 > maxChars) break;
    lines.unshift(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}
