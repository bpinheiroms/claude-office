/**
 * Lightweight agent scanner for the statusline.
 * Scans ~/.claude/projects/, classifies by mtime, parses only recent sessions.
 * File-based cache with 5s TTL at ~/.claude/plugins/claude-office/.agents-cache.json
 *
 * 100% Bun native APIs: Bun.file(), Bun.write(), Bun.spawnSync().
 */

import { readdirSync, statSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const HOME = homedir();
const PROJECTS_DIR = join(HOME, '.claude', 'projects');
const CACHE_DIR = join(HOME, '.claude', 'plugins', 'claude-office');
const CACHE_PATH = join(CACHE_DIR, '.agents-cache.json');
const CACHE_TTL_MS = 5_000;

export interface StatusLineAgent {
  name: string;
  contextPercent: number;
  status: 'working' | 'responding' | 'thinking' | 'needs_response' | 'done' | 'idle';
  lastActiveMs: number;
}

// --- File helpers (Bun native) ---

function safeReaddirSync(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function safeMtimeMs(path: string): number {
  try { return statSync(path).mtimeMs; } catch { return 0; }
}

async function readLastBytes(filePath: string, bytes: number): Promise<string[]> {
  try {
    const file = Bun.file(filePath);
    const size = file.size;
    if (size === 0) return [];
    const start = Math.max(0, size - bytes);
    const text = await file.slice(start, size).text();
    const lines = text.split('\n').filter(Boolean);
    if (start > 0 && lines.length > 0) lines.shift();
    return lines;
  } catch { return []; }
}

async function readSlice(filePath: string, start: number, end: number): Promise<string> {
  try {
    return await Bun.file(filePath).slice(start, end).text();
  } catch { return ''; }
}

// --- Agent discovery helpers (ported from collector.ts) ---

function decodeProjectName(projDir: string): string {
  const homeParts = HOME.replace(/[/.]/g, '-').replace(/^-/, '').split('-').filter(Boolean);
  const dirParts = projDir.replace(/^-/, '').split('-').filter(Boolean);

  let start = 0;
  for (const hp of homeParts) {
    if (start < dirParts.length && dirParts[start].toLowerCase() === hp.toLowerCase()) {
      start++;
    } else break;
  }

  const skipDirs = new Set(['personal', 'work', 'projects', 'documents', 'dev', 'repos', 'src', 'code', 'github', 'workspace']);
  while (start < dirParts.length - 1 && skipDirs.has(dirParts[start].toLowerCase())) {
    start++;
  }

  const meaningful = dirParts.slice(start);
  return meaningful.join('-') || dirParts[dirParts.length - 1] || projDir;
}

function discoverLiveProcesses(): Set<string> {
  const live = new Set<string>();
  try {
    const proc = Bun.spawnSync(
      ['sh', '-c', "ps -Eww -o pid,comm,args 2>/dev/null | grep '[c]laude'"],
      { stdout: 'pipe', stderr: 'ignore' },
    );
    const stdout = proc.stdout.toString();
    for (const line of stdout.trim().split('\n')) {
      if (!line) continue;
      const pwdMatch = line.match(/PWD=([^\s]+)/);
      if (pwdMatch) {
        live.add(pwdMatch[1].replace(/[/.]/g, '-'));
      }
    }
  } catch { /* no claude processes or ps failed */ }
  return live;
}

const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']);

async function parseAgentStatus(jsonlPath: string, mtimeMs: number, hasProcess: boolean): Promise<StatusLineAgent['status']> {
  const ageSecs = (Date.now() - mtimeMs) / 1000;

  if (!hasProcess && ageSecs > 3600) return 'idle';

  const lines = await readLastBytes(jsonlPath, 8192);
  if (lines.length === 0) return 'idle';

  let sawToolResult = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      const type = msg.type;
      const role = msg.message?.role;
      const content = msg.message?.content;

      if (['progress', 'file-history-snapshot', 'hook_progress', 'bash_progress'].includes(type)) continue;

      if (type === 'system' && msg.subtype === 'turn_duration') return 'done';

      if (type === 'user' && role === 'user' && Array.isArray(content)) {
        if (content.some((c: any) => c.type === 'tool_result')) {
          sawToolResult = true;
          return ageSecs > 120 ? 'done' : 'thinking';
        }
        return ageSecs > 120 ? 'done' : 'thinking';
      }

      if (type === 'assistant' && role === 'assistant' && Array.isArray(content)) {
        const toolUse = content.find((c: any) => c.type === 'tool_use');
        if (toolUse) {
          const toolName = toolUse.name || '';
          const isInteractive = INTERACTIVE_TOOLS.has(toolName);

          if (!sawToolResult) {
            if (isInteractive) return 'needs_response';
            if (hasProcess && ageSecs > 60) return 'needs_response';
            return 'working';
          }
          if (ageSecs <= 30) return 'working';
          return 'done';
        }

        const hasText = content.some((c: any) => c.type === 'text');
        if (hasText) {
          return ageSecs > 30 ? 'done' : 'responding';
        }
      }
    } catch { /* skip malformed */ }
  }

  if (ageSecs > 300) return 'idle';
  return ageSecs < 30 ? 'thinking' : 'idle';
}

const CONTEXT_WINDOW = 200_000;

async function parseContextPercent(jsonlPath: string): Promise<number> {
  const steps = [8192, 32768, 131072];
  let lastEnd = 0;

  for (const bytes of steps) {
    if (bytes <= lastEnd) continue;

    try {
      const size = Bun.file(jsonlPath).size;
      if (size === 0) return 0;

      const newStart = Math.max(0, size - bytes);
      const oldStart = Math.max(0, size - lastEnd);
      if (newStart >= oldStart) { lastEnd = bytes; continue; }

      const text = await readSlice(jsonlPath, newStart, oldStart);
      const lines = text.split('\n').filter(Boolean);
      if (newStart > 0 && lines.length > 0) lines.shift();

      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"input_tokens"')) continue;
        try {
          const msg = JSON.parse(lines[i]);
          const usage = msg.message?.usage;
          if (!usage) continue;
          const input = (usage.input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + (usage.cache_read_input_tokens || 0);
          return Math.min(100, Math.round((input / CONTEXT_WINDOW) * 100));
        } catch { /* skip */ }
      }
      lastEnd = bytes;
    } catch { /* skip */ }
  }
  return 0;
}

// --- Cache (Bun.file / Bun.write) ---

interface AgentCache {
  timestamp: number;
  agents: StatusLineAgent[];
}

async function readCache(): Promise<StatusLineAgent[] | null> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (file.size === 0) return null;
    const raw = await file.text();
    const cache: AgentCache = JSON.parse(raw);
    if (Date.now() - cache.timestamp < CACHE_TTL_MS) return cache.agents;
  } catch { /* miss */ }
  return null;
}

async function writeCache(agents: StatusLineAgent[]): Promise<void> {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    await Bun.write(CACHE_PATH, JSON.stringify({ timestamp: Date.now(), agents }));
  } catch { /* skip */ }
}

// --- Main scan ---

async function doScan(): Promise<StatusLineAgent[]> {
  const liveProcs = discoverLiveProcesses();
  const projectDirs = safeReaddirSync(PROJECTS_DIR);

  // Collect candidates (sync stat for speed)
  const candidates: { projDir: string; jsonlPath: string; mtimeMs: number; hasProcess: boolean }[] = [];

  for (const projDir of projectDirs) {
    if (projDir === '-') continue;
    const projPath = join(PROJECTS_DIR, projDir);
    const files = safeReaddirSync(projPath);

    let bestFile = '';
    let bestMtime = 0;
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const mt = safeMtimeMs(join(projPath, f));
      if (mt > bestMtime) { bestMtime = mt; bestFile = f; }
    }

    if (!bestFile || !bestMtime) continue;

    // Skip sleeping agents (mtime > 5min)
    if ((Date.now() - bestMtime) / 1000 > 300) continue;

    candidates.push({
      projDir,
      jsonlPath: join(projPath, bestFile),
      mtimeMs: bestMtime,
      hasProcess: liveProcs.has(projDir),
    });
  }

  // Parse all candidates in parallel via Bun.file() async I/O
  const agents = await Promise.all(candidates.map(async (c) => {
    const [status, contextPercent] = await Promise.all([
      parseAgentStatus(c.jsonlPath, c.mtimeMs, c.hasProcess),
      parseContextPercent(c.jsonlPath),
    ]);

    let finalStatus = status;
    if (finalStatus === 'needs_response' && !c.hasProcess) finalStatus = 'done';

    return {
      name: decodeProjectName(c.projDir),
      contextPercent,
      status: finalStatus,
      lastActiveMs: c.mtimeMs,
    } satisfies StatusLineAgent;
  }));

  // Sort: active first, then by recency
  const statusOrder: Record<string, number> = {
    working: 0, thinking: 0, responding: 0,
    needs_response: 1, idle: 2, done: 3,
  };
  agents.sort((a, b) => {
    const diff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (diff !== 0) return diff;
    return b.lastActiveMs - a.lastActiveMs;
  });

  return agents;
}

export async function scanAgents(): Promise<StatusLineAgent[]> {
  const cached = await readCache();
  if (cached) return cached;

  const agents = await doScan();
  await writeCache(agents);
  return agents;
}
