/**
 * Usage/cost scanner for the statusline.
 * Scans JSONL files for token usage, aggregates into today/week buckets.
 * File-based cache with 30s TTL at ~/.claude/plugins/claude-office/.usage-cache.json
 * Per-file mtime cache persisted to disk to avoid re-parsing unchanged files.
 *
 * 100% Bun native APIs: Bun.file().stream(), Bun.write().
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

// Opus pricing per 1M tokens
const PRICE_INPUT = 15;
const PRICE_OUTPUT = 75;
const PRICE_CACHE_WRITE = 18.75;
const PRICE_CACHE_READ = 1.50;

// Billing cycle: Friday 14:00 local time
const BILLING_CYCLE_DAY = 5;
const BILLING_CYCLE_HOUR = 14;

export interface StatusLineUsage {
  todayCostUSD: number;
  weekCostUSD: number;
}

interface TokenBucket {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

interface FileBucketEntry {
  mtimeMs: number;
  bucket: TokenBucket;
}

interface UsageCache {
  timestamp: number;
  usage: StatusLineUsage;
  fileBuckets: Record<string, FileBucketEntry>;
}

// --- Helpers ---

function safeReaddirSync(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function safeMtimeMs(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

function emptyBucket(): TokenBucket {
  return { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };
}

function addBucket(target: TokenBucket, src: TokenBucket): void {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheWriteTokens += src.cacheWriteTokens;
  target.cacheReadTokens += src.cacheReadTokens;
}

function estimateCost(b: TokenBucket): number {
  return (
    (b.inputTokens / 1_000_000) * PRICE_INPUT +
    (b.outputTokens / 1_000_000) * PRICE_OUTPUT +
    (b.cacheWriteTokens / 1_000_000) * PRICE_CACHE_WRITE +
    (b.cacheReadTokens / 1_000_000) * PRICE_CACHE_READ
  );
}

function getBillingCycleStart(now: Date): Date {
  const day = now.getDay();
  const hour = now.getHours();
  let daysBack = (day - BILLING_CYCLE_DAY + 7) % 7;
  if (daysBack === 0 && hour < BILLING_CYCLE_HOUR) daysBack = 7;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack, BILLING_CYCLE_HOUR, 0, 0, 0);
}

// --- File parsing (Bun.file().stream()) ---

async function parseFileUsage(filePath: string): Promise<TokenBucket> {
  const bucket = emptyBucket();
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
          try {
            const msg = JSON.parse(line);
            const usage = msg.message?.usage;
            if (usage) {
              bucket.inputTokens += usage.input_tokens || 0;
              bucket.outputTokens += usage.output_tokens || 0;
              bucket.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
              bucket.cacheReadTokens += usage.cache_read_input_tokens || 0;
            }
          } catch { /* skip */ }
        }
        nl = text.indexOf('\n', start);
      }
      partial = text.substring(start);
    }

    if (partial.includes('"usage"')) {
      try {
        const msg = JSON.parse(partial);
        const usage = msg.message?.usage;
        if (usage) {
          bucket.inputTokens += usage.input_tokens || 0;
          bucket.outputTokens += usage.output_tokens || 0;
          bucket.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
          bucket.cacheReadTokens += usage.cache_read_input_tokens || 0;
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return bucket;
}

// --- Cache (Bun.file / Bun.write) ---

async function readCache(): Promise<{ usage: StatusLineUsage | null; fileBuckets: Record<string, FileBucketEntry> } | null> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (file.size === 0) return null;
    const raw = await file.text();
    const cache: UsageCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS) {
      return { usage: cache.usage, fileBuckets: cache.fileBuckets };
    }
    // Cache expired — return fileBuckets for mtime optimization
    return { usage: null, fileBuckets: cache.fileBuckets };
  } catch { /* miss */ }
  return null;
}

async function writeCache(usage: StatusLineUsage, fileBuckets: Record<string, FileBucketEntry>): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    await Bun.write(CACHE_PATH, JSON.stringify({ timestamp: Date.now(), usage, fileBuckets }));
  } catch { /* skip */ }
}

// --- Main scan ---

async function doScan(prevFileBuckets: Record<string, FileBucketEntry>): Promise<{ usage: StatusLineUsage; fileBuckets: Record<string, FileBucketEntry> }> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = getBillingCycleStart(now);

  const today = emptyBucket();
  const week = emptyBucket();
  const fileBuckets: Record<string, FileBucketEntry> = {};

  const projectDirs = safeReaddirSync(PROJECTS_DIR);
  const parsePromises: Promise<void>[] = [];

  for (const projDir of projectDirs) {
    if (projDir === '-') continue;
    const projPath = join(PROJECTS_DIR, projDir);
    const files = safeReaddirSync(projPath);

    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = join(projPath, f);
      const mtimeMs = safeMtimeMs(filePath);
      if (!mtimeMs || mtimeMs < weekStart.getTime()) continue;

      const isToday = mtimeMs >= todayStart.getTime();

      // Check per-file mtime cache
      const cached = prevFileBuckets[filePath];
      if (cached && cached.mtimeMs === mtimeMs) {
        fileBuckets[filePath] = cached;
        if (isToday) addBucket(today, cached.bucket);
        addBucket(week, cached.bucket);
        continue;
      }

      // Need to parse — push async work
      parsePromises.push(
        parseFileUsage(filePath).then((bucket) => {
          fileBuckets[filePath] = { mtimeMs, bucket };
          if (isToday) addBucket(today, bucket);
          addBucket(week, bucket);
        })
      );

      // Sub-agent files
      const subDir = join(projPath, f.replace('.jsonl', ''), 'subagents');
      for (const sf of safeReaddirSync(subDir)) {
        if (!sf.endsWith('.jsonl')) continue;
        const subPath = join(subDir, sf);
        const subMtime = safeMtimeMs(subPath);
        if (!subMtime || subMtime < weekStart.getTime()) continue;

        const subIsToday = subMtime >= todayStart.getTime();
        const subCached = prevFileBuckets[subPath];
        if (subCached && subCached.mtimeMs === subMtime) {
          fileBuckets[subPath] = subCached;
          if (subIsToday) addBucket(today, subCached.bucket);
          addBucket(week, subCached.bucket);
          continue;
        }

        parsePromises.push(
          parseFileUsage(subPath).then((bucket) => {
            fileBuckets[subPath] = { mtimeMs: subMtime, bucket };
            if (subIsToday) addBucket(today, bucket);
            addBucket(week, bucket);
          })
        );
      }
    }
  }

  await Promise.all(parsePromises);

  return {
    usage: { todayCostUSD: estimateCost(today), weekCostUSD: estimateCost(week) },
    fileBuckets,
  };
}

export async function scanUsage(): Promise<StatusLineUsage> {
  const cached = await readCache();

  // Fresh cache — return immediately
  if (cached?.usage) return cached.usage;

  // Stale or missing — scan with mtime optimization
  const prevBuckets = cached?.fileBuckets ?? {};
  const result = await doScan(prevBuckets);
  await writeCache(result.usage, result.fileBuckets);
  return result.usage;
}
