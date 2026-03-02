/**
 * Parse Claude Code JSONL transcript for tool activity, agent status, and todos.
 *
 * Performance strategy:
 *   - 100% Bun APIs (Bun.file, Bun.write) — no Node.js fs/readline
 *   - Incremental reading: caches file size and only reads new bytes on append
 *   - Mtime-based cache with 10s TTL for aggregate result
 *   - Persistent cache at ~/.claude/plugins/claude-office/.transcript-cache.json
 */

import { join } from 'path';
import { homedir } from 'os';

// --- Types ---

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface AgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  startTime: Date;
  endTime?: Date;
}

export interface TodoEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface TranscriptData {
  tools: ToolEntry[];
  agents: AgentEntry[];
  todos: TodoEntry[];
  sessionStart?: Date;
}

const EMPTY: TranscriptData = { tools: [], agents: [], todos: [] };

// --- Cache ---

const CACHE_DIR = join(homedir(), '.claude', 'plugins', 'claude-office');
const CACHE_PATH = join(CACHE_DIR, '.transcript-cache.json');
const CACHE_TTL_MS = 10_000;

interface TranscriptCache {
  timestamp: number;
  filePath: string;
  fileSize: number;
  mtimeMs: number;
  // Serialized state for incremental parsing
  toolMapEntries: [string, SerializedToolEntry][];
  agentMapEntries: [string, SerializedAgentEntry][];
  todos: TodoEntry[];
  taskIdToIndexEntries: [string, number][];
  sessionStart?: string;
}

interface SerializedToolEntry {
  id: string;
  name: string;
  target?: string;
  status: 'running' | 'completed' | 'error';
  startTime: string;
  endTime?: string;
}

interface SerializedAgentEntry {
  id: string;
  type: string;
  model?: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  startTime: string;
  endTime?: string;
}

function serializeTool(t: ToolEntry): SerializedToolEntry {
  return { ...t, startTime: t.startTime.toISOString(), endTime: t.endTime?.toISOString() };
}

function deserializeTool(s: SerializedToolEntry): ToolEntry {
  return { ...s, startTime: new Date(s.startTime), endTime: s.endTime ? new Date(s.endTime) : undefined };
}

function serializeAgent(a: AgentEntry): SerializedAgentEntry {
  return { ...a, startTime: a.startTime.toISOString(), endTime: a.endTime?.toISOString() };
}

function deserializeAgent(s: SerializedAgentEntry): AgentEntry {
  return { ...s, startTime: new Date(s.startTime), endTime: s.endTime ? new Date(s.endTime) : undefined };
}

// --- Parsing state (reused across incremental reads) ---

interface ParseState {
  toolMap: Map<string, ToolEntry>;
  agentMap: Map<string, AgentEntry>;
  todos: TodoEntry[];
  taskIdToIndex: Map<string, number>;
  sessionStart?: Date;
}

function emptyState(): ParseState {
  return {
    toolMap: new Map(),
    agentMap: new Map(),
    todos: [],
    taskIdToIndex: new Map(),
  };
}

// --- Helpers ---

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

function extractTarget(toolName: string, input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return (input.file_path as string) ?? (input.path as string);
    case 'Glob':
    case 'Grep':
      return input.pattern as string;
    case 'Bash': {
      const cmd = input.command as string;
      if (!cmd) return undefined;
      return cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd;
    }
    case 'WebFetch':
      return input.url as string;
    case 'WebSearch':
      return input.query as string;
  }
  return undefined;
}

function resolveTaskIndex(
  taskId: unknown,
  taskIdToIndex: Map<string, number>,
  todos: TodoEntry[]
): number | null {
  if (typeof taskId === 'string' || typeof taskId === 'number') {
    const key = String(taskId);
    const mapped = taskIdToIndex.get(key);
    if (typeof mapped === 'number' && mapped < todos.length) return mapped;

    if (/^\d+$/.test(key)) {
      const idx = Number.parseInt(key, 10) - 1;
      if (idx >= 0 && idx < todos.length) return idx;
    }
  }
  return null;
}

function normalizeTaskStatus(status: unknown): TodoEntry['status'] | null {
  if (typeof status !== 'string') return null;
  switch (status) {
    case 'pending':
    case 'not_started':
      return 'pending';
    case 'in_progress':
    case 'running':
      return 'in_progress';
    case 'completed':
    case 'complete':
    case 'done':
      return 'completed';
    case 'deleted':
      return 'completed'; // treat deleted as done for display
    default:
      return null;
  }
}

// --- Line processor ---

function processLine(line: string, state: ParseState): void {
  if (!line || line.length < 10) return;

  let entry: { timestamp?: string; message?: { content?: ContentBlock[] } };
  try {
    entry = JSON.parse(line);
  } catch {
    return;
  }

  const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
  if (!state.sessionStart && entry.timestamp) {
    state.sessionStart = timestamp;
  }

  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return;

  for (const block of content) {
    // --- tool_use ---
    if (block.type === 'tool_use' && block.id && block.name) {
      if (block.name === 'Agent') {
        const input = block.input as Record<string, unknown> | undefined;
        state.agentMap.set(block.id, {
          id: block.id,
          type: (input?.subagent_type as string) ?? 'unknown',
          model: (input?.model as string) ?? undefined,
          description: (input?.description as string) ?? undefined,
          status: 'running',
          startTime: timestamp,
        });
      } else if (block.name === 'TodoWrite') {
        const input = block.input as { todos?: Array<Record<string, unknown>> } | undefined;
        if (input?.todos && Array.isArray(input.todos)) {
          state.todos.length = 0;
          state.taskIdToIndex.clear();
          for (const t of input.todos) {
            const id = (t.id as string) || (t.content as string) || '';
            const todoContent = (t.content as string) || id;
            const status = normalizeTaskStatus(t.status) ?? 'pending';
            state.todos.push({ content: todoContent, status });
            if (id) state.taskIdToIndex.set(id, state.todos.length - 1);
          }
        }
      } else if (block.name === 'TaskCreate') {
        const input = block.input as Record<string, unknown> | undefined;
        if (input) {
          const subject = typeof input.subject === 'string' ? input.subject : '';
          const desc = typeof input.description === 'string' ? input.description : '';
          const taskContent = subject || desc || 'Untitled task';
          const status = normalizeTaskStatus(input.status) ?? 'pending';
          state.todos.push({ content: taskContent, status });

          const rawId = input.taskId;
          const taskId = typeof rawId === 'string' || typeof rawId === 'number'
            ? String(rawId) : block.id;
          if (taskId) state.taskIdToIndex.set(taskId, state.todos.length - 1);
        }
      } else if (block.name === 'TaskUpdate') {
        const input = block.input as Record<string, unknown> | undefined;
        if (input) {
          const index = resolveTaskIndex(input.taskId, state.taskIdToIndex, state.todos);
          if (index !== null) {
            const status = normalizeTaskStatus(input.status);
            if (status) state.todos[index].status = status;
            const subject = typeof input.subject === 'string' ? input.subject : '';
            const desc = typeof input.description === 'string' ? input.description : '';
            const newContent = subject || desc;
            if (newContent) state.todos[index].content = newContent;
          }
        }
      } else {
        state.toolMap.set(block.id, {
          id: block.id,
          name: block.name,
          target: extractTarget(block.name, block.input),
          status: 'running',
          startTime: timestamp,
        });
      }
    }

    // --- tool_result ---
    if (block.type === 'tool_result' && block.tool_use_id) {
      const tool = state.toolMap.get(block.tool_use_id);
      if (tool) {
        tool.status = block.is_error ? 'error' : 'completed';
        tool.endTime = timestamp;
      }

      const agent = state.agentMap.get(block.tool_use_id);
      if (agent) {
        agent.status = block.is_error ? 'error' : 'completed';
        agent.endTime = timestamp;
      }
    }
  }
}

// --- Streaming line parser using Bun ---

async function parseLines(filePath: string, fromByte: number, state: ParseState): Promise<void> {
  const file = Bun.file(filePath);
  const size = file.size;
  if (fromByte >= size) return;

  const stream = file.slice(fromByte, size).stream();
  const decoder = new TextDecoder();
  let partial = '';

  for await (const chunk of stream) {
    const text = partial + decoder.decode(chunk, { stream: true });
    let start = 0;
    let nl = text.indexOf('\n', start);
    while (nl !== -1) {
      const line = text.substring(start, nl);
      start = nl + 1;
      processLine(line, state);
      nl = text.indexOf('\n', start);
    }
    partial = text.substring(start);
  }

  // Process last partial line
  if (partial.length > 0) {
    processLine(partial, state);
  }
}

// --- Build result from state ---

function buildResult(state: ParseState): TranscriptData {
  return {
    tools: Array.from(state.toolMap.values()).slice(-20),
    agents: Array.from(state.agentMap.values()).slice(-10),
    todos: state.todos,
    sessionStart: state.sessionStart,
  };
}

// --- Cache I/O ---

async function readCache(): Promise<TranscriptCache | null> {
  try {
    const file = Bun.file(CACHE_PATH);
    if (file.size === 0) return null;
    const raw = await file.text();
    return JSON.parse(raw) as TranscriptCache;
  } catch {
    return null;
  }
}

async function writeCache(
  filePath: string,
  fileSize: number,
  mtimeMs: number,
  state: ParseState,
): Promise<void> {
  try {
    const cache: TranscriptCache = {
      timestamp: Date.now(),
      filePath,
      fileSize,
      mtimeMs,
      toolMapEntries: Array.from(state.toolMap.entries()).map(([k, v]) => [k, serializeTool(v)]),
      agentMapEntries: Array.from(state.agentMap.entries()).map(([k, v]) => [k, serializeAgent(v)]),
      todos: state.todos,
      taskIdToIndexEntries: Array.from(state.taskIdToIndex.entries()),
      sessionStart: state.sessionStart?.toISOString(),
    };
    await Bun.write(CACHE_PATH, JSON.stringify(cache));
  } catch { /* skip */ }
}

function restoreState(cache: TranscriptCache): ParseState {
  const state = emptyState();
  for (const [k, v] of cache.toolMapEntries) state.toolMap.set(k, deserializeTool(v));
  for (const [k, v] of cache.agentMapEntries) state.agentMap.set(k, deserializeAgent(v));
  state.todos = cache.todos;
  for (const [k, v] of cache.taskIdToIndexEntries) state.taskIdToIndex.set(k, v);
  state.sessionStart = cache.sessionStart ? new Date(cache.sessionStart) : undefined;
  return state;
}

// --- Main parser ---

export async function parseTranscript(transcriptPath: string): Promise<TranscriptData> {
  if (!transcriptPath) return EMPTY;

  const file = Bun.file(transcriptPath);
  const exists = await file.exists();
  if (!exists) return EMPTY;

  const stat = await file.stat();
  const fileSize = stat?.size ?? 0;
  const mtimeMs = stat?.mtimeMs ?? 0;
  if (fileSize === 0) return EMPTY;

  // Check cache
  const cache = await readCache();

  // Fresh cache hit: same file, within TTL
  if (cache && cache.filePath === transcriptPath && cache.mtimeMs === mtimeMs
      && cache.fileSize === fileSize && (Date.now() - cache.timestamp) < CACHE_TTL_MS) {
    const state = restoreState(cache);
    return buildResult(state);
  }

  // Incremental: file only grew (appended), restore state and parse new bytes
  if (cache && cache.filePath === transcriptPath && cache.fileSize < fileSize
      && cache.fileSize > 0) {
    const state = restoreState(cache);
    // Skip first partial line if reading mid-file
    const fromByte = cache.fileSize;
    await parseLines(transcriptPath, fromByte, state);
    await writeCache(transcriptPath, fileSize, mtimeMs, state);
    return buildResult(state);
  }

  // Full parse: new file or file was truncated/replaced
  const state = emptyState();
  await parseLines(transcriptPath, 0, state);
  await writeCache(transcriptPath, fileSize, mtimeMs, state);
  return buildResult(state);
}
