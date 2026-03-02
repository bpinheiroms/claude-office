/**
 * Usage/cost scanner for the statusline.
 * Scans JSONL files for token usage, prices per-model, aggregates into today/week/month.
 *
 * Key design:
 *   - Per-MESSAGE timestamp bucketing (not per-file) for accurate time-window costs.
 *   - Each message's cost uses the specific model's API pricing.
 *   - File-based cache stores daily cost breakdown per file (compact + re-bucketable).
 *   - 30s TTL on the aggregate result; per-file mtime tracking avoids re-parsing unchanged files.
 *   - Handles worktrees, multiple sessions, sub-agent files.
 */

import { readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const CLAUDE_DIR = join(HOME, '.claude');
const PROJECTS_DIR = join(CLAUDE_DIR, 'projects');
const CACHE_DIR = join(CLAUDE_DIR, 'plugins', 'claude-office');
const CACHE_PATH = join(CACHE_DIR, '.usage-cache.json');
const CACHE_TTL_MS = 30_000;

// --- Model pricing (per 1M tokens, USD) ---

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

const PRICING: Record<string, ModelPricing> = {
  'opus-4.6':   { input: 5,    output: 25,   cacheWrite: 6.25,  cacheRead: 0.50 },
  'opus-4.5':   { input: 5,    output: 25,   cacheWrite: 6.25,  cacheRead: 0.50 },
  'opus-4.1':   { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  'opus-4':     { input: 15,   output: 75,   cacheWrite: 18.75, cacheRead: 1.50 },
  'sonnet-4.6': { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'sonnet-4.5': { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'sonnet-4':   { input: 3,    output: 15,   cacheWrite: 3.75,  cacheRead: 0.30 },
  'haiku-4.5':  { input: 1,    output: 5,    cacheWrite: 1.25,  cacheRead: 0.10 },
  'haiku-3.5':  { input: 0.80, output: 4,    cacheWrite: 1.00,  cacheRead: 0.08 },
};

const DEFAULT_PRICING: ModelPricing = PRICING['opus-4.6'];

function getPricing(modelId: string): ModelPricing {
  const lower = modelId.toLowerCase();

  // Extract family and version: "opus-4.6", "sonnet-4.5", etc.
  const match = lower.match(/(opus|sonnet|haiku)-(\d+)[-.](\d+)/);
  if (match) {
    const key = `${match[1]}-${match[2]}.${match[3]}`;
    if (PRICING[key]) return PRICING[key];
  }

  // Fallback: family-major (e.g. "opus-4")
  const matchMajor = lower.match(/(opus|sonnet|haiku)-(\d+)/);
  if (matchMajor) {
    const key = `${matchMajor[1]}-${matchMajor[2]}`;
    if (PRICING[key]) return PRICING[key];
  }

  return DEFAULT_PRICING;
}

// --- Billing cycle ---

const BILLING_CYCLE_DAY = 5;  // Friday
const BILLING_CYCLE_HOUR = 14;

function getBillingCycleStart(now: Date): Date {
  const day = now.getDay();
  const hour = now.getHours();
  let daysBack = (day - BILLING_CYCLE_DAY + 7) % 7;
  if (daysBack === 0 && hour < BILLING_CYCLE_HOUR) daysBack = 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, BILLING_CYCLE_HOUR, 0, 0, 0);
}

// --- Types ---

export interface StatusLineUsage {
  todayCostUSD: number;
  weekCostUSD: number;
  monthCostUSD: number;
}

/** Per-file cache: stores daily cost breakdown so we can re-bucket without re-parsing. */
interface FileCostEntry {
  mtimeMs: number;
  dailyCosts: Record<string, number>; // "2026-03-02" → USD
}

interface UsageCache {
  timestamp: number;
  usage: StatusLineUsage;
  fileCosts: Record<string, FileCostEntry>;
}

// --- Helpers ---

function safeReaddirSync(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function safeMtimeMs(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// --- Per-message parsing ---

interface MessageCost {
  dateKey: string;
  costUSD: number;
}

function parseMessageCost(line: string, fallbackDateKey: string): MessageCost | null {
  try {
    const msg = JSON.parse(line);
    const message = msg.message;
    if (!message?.usage) return null;

    const model = message.model || '';
    const usage = message.usage;
    const pricing = getPricing(model);

    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;

    const costUSD = (
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output +
      (cacheWriteTokens / 1_000_000) * pricing.cacheWrite +
      (cacheReadTokens / 1_000_000) * pricing.cacheRead
    );

    if (costUSD === 0) return null;

    // Use message timestamp for accurate day bucketing
    const rawTs = msg.timestamp;
    let dateKey: string;
    if (typeof rawTs === 'string' || typeof rawTs === 'number') {
      const date = new Date(rawTs);
      dateKey = isNaN(date.getTime()) ? fallbackDateKey : toDateKey(date);
    } else {
      dateKey = fallbackDateKey;
    }

    return { dateKey, costUSD };
  } catch {
    return null;
  }
}

/** Parse a JSONL file into a daily cost breakdown. */
async function parseFileDailyCosts(filePath: string, fallbackDateKey: string): Promise<Record<string, number>> {
  const dailyCosts: Record<string, number> = {};
  try {
    const stream = Bun.file(filePath).stream();
    const decoder = new TextDecoder();
    let partial = '';

    for await (const chunk of stream) {
      const text = partial + decoder.decode(chunk, { stream: true });
      let start = 0;
      let nl = text.indexOf('\n', start);
      while (nl !== -1) {
        const line = text.substring(start, nl);
        start = nl + 1;
        if (line.includes('"usage"')) {
          const result = parseMessageCost(line, fallbackDateKey);
          if (result) {
            dailyCosts[result.dateKey] = (dailyCosts[result.dateKey] || 0) + result.costUSD;
          }
        }
        nl = text.indexOf('\n', start);
      }
      partial = text.substring(start);
    }

    if (partial.includes('"usage"')) {
      const result = parseMessageCost(partial, fallbackDateKey);
      if (result) {
        dailyCosts[result.dateKey] = (dailyCosts[result.dateKey] || 0) + result.costUSD;
      }
    }
  } catch { /* skip */ }
  return dailyCosts;
}

// --- Cache ---

async function readCache(): Promise<{ usage: StatusLineUsage | null; fileCosts: Record<string, FileCostEntry> } | null> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (file.size === 0) return null;
    const raw = await file.text();
    const cache: UsageCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS) {
      return { usage: cache.usage, fileCosts: cache.fileCosts };
    }
    return { usage: null, fileCosts: cache.fileCosts };
  } catch { /* miss */ }
  return null;
}

async function writeCache(usage: StatusLineUsage, fileCosts: Record<string, FileCostEntry>): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    await Bun.write(CACHE_PATH, JSON.stringify({ timestamp: Date.now(), usage, fileCosts }));
  } catch { /* skip */ }
}

// --- Main scan ---

async function doScan(prevFileCosts: Record<string, FileCostEntry>): Promise<{ usage: StatusLineUsage; fileCosts: Record<string, FileCostEntry> }> {
  const now = new Date();
  const todayKey = toDateKey(now);
  const weekStart = getBillingCycleStart(now);
  const weekStartKey = toDateKey(weekStart);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartKey = toDateKey(monthStart);

  let todayCost = 0;
  let weekCost = 0;
  let monthCost = 0;
  const fileCosts: Record<string, FileCostEntry> = {};

  /** Add a file's daily costs into the aggregate time-window buckets. */
  function addToBuckets(dailyCosts: Record<string, number>) {
    for (const [dateKey, cost] of Object.entries(dailyCosts)) {
      if (dateKey >= monthStartKey) monthCost += cost;
      if (dateKey >= weekStartKey) weekCost += cost;
      if (dateKey === todayKey) todayCost += cost;
    }
  }

  const projectDirs = safeReaddirSync(PROJECTS_DIR);
  const parsePromises: Promise<void>[] = [];

  // Only process files that could contain data within our time windows
  const earliestCutoff = Math.min(weekStart.getTime(), monthStart.getTime());

  function processFile(filePath: string, mtimeMs: number) {
    if (!mtimeMs || mtimeMs < earliestCutoff) return;

    // Reuse cached daily breakdown if file hasn't changed
    const cached = prevFileCosts[filePath];
    if (cached && cached.mtimeMs === mtimeMs && cached.dailyCosts) {
      fileCosts[filePath] = cached;
      addToBuckets(cached.dailyCosts);
      return;
    }

    const fallbackDateKey = toDateKey(new Date(mtimeMs));
    parsePromises.push(
      parseFileDailyCosts(filePath, fallbackDateKey).then((dailyCosts) => {
        fileCosts[filePath] = { mtimeMs, dailyCosts };
        addToBuckets(dailyCosts);
      })
    );
  }

  for (const projDir of projectDirs) {
    if (projDir === '-') continue;
    const projPath = join(PROJECTS_DIR, projDir);

    for (const f of safeReaddirSync(projPath)) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = join(projPath, f);
      processFile(filePath, safeMtimeMs(filePath));

      // Sub-agent files (worktrees, spawned agents)
      const subDir = join(projPath, f.replace('.jsonl', ''), 'subagents');
      for (const sf of safeReaddirSync(subDir)) {
        if (!sf.endsWith('.jsonl')) continue;
        processFile(join(subDir, sf), safeMtimeMs(join(subDir, sf)));
      }
    }
  }

  await Promise.all(parsePromises);

  return {
    usage: { todayCostUSD: todayCost, weekCostUSD: weekCost, monthCostUSD: monthCost },
    fileCosts,
  };
}

export async function scanUsage(): Promise<StatusLineUsage> {
  const cached = await readCache();
  if (cached?.usage) return cached.usage;

  const prevCosts = cached?.fileCosts ?? {};
  const result = await doScan(prevCosts);
  await writeCache(result.usage, result.fileCosts);
  return result.usage;
}

/** @internal — exported for unit testing only */
export const _test = {
  getPricing, getBillingCycleStart, toDateKey, parseMessageCost,
};
