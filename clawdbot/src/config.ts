import { readFileSync, existsSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Filters } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Walk up from clawdbot/dist (or src) until we find this repo’s `data/` or the root `package.json` named `chud`. */
function findRepoRoot(): string {
  let dir = here;
  for (let i = 0; i < 18; i++) {
    if (existsSync(join(dir, "data", "trades.json"))) return dir;
    if (existsSync(join(dir, "data")) && existsSync(join(dir, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as { name?: string };
        if (pkg.name === "chud") return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(here, "..", "..");
}

function resolveExplicitDir(raw: string): string {
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

/**
 * Directory for trades.json, state.json, logs, chat files, etc.
 * Evaluated on each call so `.env` is respected even when this module loads before dotenv in some entrypoints.
 */
export function getDataDir(): string {
  const override = process.env.CHUD_DATA_FILES_DIR?.trim();
  if (override) return resolveExplicitDir(override);

  const raw = process.env.DATA_DIR?.trim();
  const repo = findRepoRoot();
  const defaultData = join(repo, "data");

  if (raw) {
    if (isAbsolute(raw)) return raw;
    const candidates = [
      join(process.cwd(), raw),
      join(repo, raw),
      join(process.cwd(), "..", raw),
      join(dirname(repo), raw),
    ];
    for (const c of candidates) {
      if (existsSync(join(c, "trades.json"))) return c;
    }
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    return join(process.cwd(), raw);
  }

  if (existsSync(join(defaultData, "trades.json"))) return defaultData;
  const cwdData = join(process.cwd(), "data");
  if (existsSync(join(cwdData, "trades.json"))) return cwdData;
  return defaultData;
}

export function getConfigDir(): string {
  const custom = process.env.CONFIG_DIR?.trim();
  if (custom) return isAbsolute(custom) ? custom : join(process.cwd(), custom);
  return join(findRepoRoot(), "config");
}

export function loadFilters(): Filters {
  try {
    const path = join(getConfigDir(), "filters.json");
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as Filters;
  } catch {
    return {
      minVolumeUsd: 5000,
      minMcapUsd: 5000,
      maxMcapUsd: 31400,
      minGlobalFeesPaidSol: 0.8,
      maxAgeMinutes: 60,
      maxPositionSol: 0.1,
      maxPositionPercent: 10,
      maxCandidates: 3,
      holdMinSeconds: 0,
      holdMaxSeconds: 600,
      loopDelayMs: 0,
      takeProfitPercent: 50,
      stopLossPercent: -25,
      slippagePercent: 15,
      priorityFeeSol: 0.0001,
    };
  }
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true" || !process.env.SOLANA_RPC_URL?.trim();
}

export function getChudOwnTokenMint(): string {
  return (process.env.CHUD_OWN_TOKEN_MINT || "").trim();
}
