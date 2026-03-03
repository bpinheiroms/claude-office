/**
 * Shared test data factories for claude-office unit tests.
 */

import type { StdinData } from '../../stdin.js';
import type { QuotaData } from '../../../data/types.js';
import type { DisplayConfig } from '../../config.js';
import type { StatusLineUsage } from '../../usage-scanner.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoEntry } from '../../transcript.js';

// --- StdinData ---

export function makeStdin(overrides: Partial<StdinData> = {}): StdinData {
  return {
    modelName: 'Claude Opus 4.6',
    contextPercent: 42,
    contextTokens: 84_000,
    contextWindowSize: 200_000,
    cwd: '/home/user/project',
    transcriptPath: '/tmp/transcript.jsonl',
    ...overrides,
  };
}

// --- QuotaData ---

export function makeQuota(overrides: Partial<QuotaData> = {}): QuotaData {
  return {
    fiveHour: 14,
    sevenDay: 35,
    fiveHourResetAt: new Date('2026-03-02T18:00:00Z'),
    sevenDayResetAt: new Date('2026-03-06T14:00:00Z'),
    planName: 'Max',
    ...overrides,
  };
}

// --- DisplayConfig ---

export function makeConfig(overrides: Partial<DisplayConfig> = {}): DisplayConfig {
  return {
    lineLayout: 'expanded',
    showPlan: true,
    showQuota5h: true,
    showQuota7d: true,
    showContext: true,
    showToday: true,
    showWeek: true,
    showMonth: true,
    showSaving: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
    ...overrides,
  };
}

export function makeMinimalConfig(overrides: Partial<DisplayConfig> = {}): DisplayConfig {
  return {
    lineLayout: 'compact',
    showPlan: true,
    showQuota5h: true,
    showQuota7d: false,
    showContext: true,
    showToday: true,
    showWeek: false,
    showMonth: false,
    showSaving: true,
    showTools: false,
    showAgents: false,
    showTodos: false,
    ...overrides,
  };
}

// --- StatusLineUsage ---

export function makeUsage(overrides: Partial<StatusLineUsage> = {}): StatusLineUsage {
  return {
    todayCostUSD: 51.20,
    weekCostUSD: 180.50,
    monthCostUSD: 420.00,
    ...overrides,
  };
}

// --- ToolEntry ---

export function makeTool(overrides: Partial<ToolEntry> = {}): ToolEntry {
  return {
    id: 'tool-1',
    name: 'Read',
    target: '/src/index.ts',
    status: 'completed',
    startTime: new Date('2026-03-02T10:00:00Z'),
    endTime: new Date('2026-03-02T10:00:01Z'),
    ...overrides,
  };
}

// --- AgentEntry ---

export function makeAgent(overrides: Partial<AgentEntry> = {}): AgentEntry {
  return {
    id: 'agent-1',
    type: 'Explore',
    model: 'sonnet',
    description: 'Searching auth module',
    status: 'running',
    startTime: new Date('2026-03-02T10:00:00Z'),
    ...overrides,
  };
}

// --- TodoEntry ---

export function makeTodo(overrides: Partial<TodoEntry> = {}): TodoEntry {
  return {
    content: 'Implement login flow',
    status: 'in_progress',
    ...overrides,
  };
}

// --- TranscriptData ---

export function makeTranscript(overrides: Partial<TranscriptData> = {}): TranscriptData {
  return {
    tools: [],
    agents: [],
    todos: [],
    ...overrides,
  };
}

// --- JSONL helpers ---

export function makeJsonlLine(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

export function makeToolUseLine(id: string, name: string, input?: Record<string, unknown>): string {
  return makeJsonlLine({
    timestamp: '2026-03-02T10:00:00Z',
    message: {
      content: [{ type: 'tool_use', id, name, input }],
    },
  });
}

export function makeToolResultLine(toolUseId: string, isError = false): string {
  return makeJsonlLine({
    timestamp: '2026-03-02T10:00:01Z',
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }],
    },
  });
}

export function makeUsageMessage(opts: {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  timestamp?: string;
} = {}): string {
  return makeJsonlLine({
    timestamp: opts.timestamp ?? '2026-03-02T10:00:00Z',
    message: {
      model: opts.model ?? 'claude-opus-4-6',
      usage: {
        input_tokens: opts.inputTokens ?? 1000,
        output_tokens: opts.outputTokens ?? 500,
        cache_creation_input_tokens: opts.cacheWriteTokens ?? 0,
        cache_read_input_tokens: opts.cacheReadTokens ?? 0,
      },
    },
  });
}
