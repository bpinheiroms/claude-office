/**
 * Multi-line ANSI renderer for the statusline.
 *
 * Layout:
 *   Expanded:  Line 1 = Plan + Today + Week + Month + Monthly Saving
 *              Line 2 = 5h quota + 7d quota + Current Context bar
 *   Compact:   Line 1 = All on one line
 *   +optional: Tools line, Agent lines, Todo line
 *
 * Uses \u00A0 (non-breaking space) to prevent whitespace collapsing.
 * Uses 24-bit RGB ANSI colors via \x1b[38;2;r;g;bm.
 */

import type { StdinData } from './stdin.js';
import type { StatusLineUsage } from './usage-scanner.js';
import type { QuotaData } from '../data/types.js';
import type { DisplayConfig } from './config.js';
import type { TranscriptData, ToolEntry, AgentEntry, TodoEntry } from './transcript.js';

const S = '\u00A0';  // non-breaking space

// --- ANSI ---

const E = '\x1b';
const RST = `${E}[0m`;
const BOLD = `${E}[1m`;
const c = (r: number, g: number, b: number) => `${E}[38;2;${r};${g};${b}m`;

const C = {
  active:  c(74, 222, 128),
  urgent:  c(255, 120, 100),
  done:    c(90, 85, 75),
  idle:    c(250, 204, 21),
  dim:     c(90, 85, 75),
  dimmer:  c(55, 52, 45),
  bright:  c(220, 215, 205),
  model:   c(140, 120, 200),
  costBig: c(240, 180, 80),
  ctxWarn: c(250, 180, 50),
  ctxCrit: c(240, 80, 80),
  sub:     c(160, 140, 200),
  tool:    c(100, 180, 220),
};

// --- Helpers ---

function quotaColor(pct: number): string {
  if (pct >= 90) return C.ctxCrit;
  if (pct >= 75) return C.ctxWarn;
  return C.sub;
}

function dotBar(pct: number, color: string, width: number = 10): string {
  const safe = Math.max(0, Math.min(100, pct));
  const filled = Math.round((safe / 100) * width);
  const empty = width - filled;
  return `${color}${'\u2501'.repeat(filled)}${C.dimmer}${'\u2501'.repeat(empty)}${RST}`;
}

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

function truncatePath(path: string, maxLen: number = 20): string {
  const p = path.replace(/\\/g, '/');
  if (p.length <= maxLen) return p;
  const parts = p.split('/');
  const file = parts.pop() || p;
  if (file.length >= maxLen) return file.slice(0, maxLen - 3) + '...';
  return '.../' + file;
}

function truncate(text: string, maxLen: number = 40): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

function formatElapsed(agent: AgentEntry): string {
  const start = agent.startTime.getTime();
  const end = agent.endTime?.getTime() ?? Date.now();
  const ms = end - start;
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m${S}${secs}s`;
}

// --- Part builders: Quota & Costs ---

function buildPlanPart(config: DisplayConfig, quota: QuotaData | null): string | null {
  if (!config.showPlan) return null;
  const name = quota?.planName || '';
  if (!name) return null;
  return `${BOLD}${C.model}Plan${S}${name}${RST}`;
}

function buildQuotaPart(label: string, pct: number | null | undefined): string | null {
  if (pct == null) return null;
  if (pct >= 100) return `${C.dim}${label}${S}${C.ctxCrit}LIMIT${RST}`;
  return `${C.dim}${label}${S}${dotBar(pct, quotaColor(pct))}${S}${quotaColor(pct)}${pct}%${RST}`;
}

function buildContextPart(config: DisplayConfig, stdin: StdinData): string | null {
  if (!config.showContext || stdin.contextPercent <= 0) return null;
  const pct = stdin.contextPercent;
  return `${C.dim}Current${S}Context${S}${dotBar(pct, quotaColor(pct))}${S}${quotaColor(pct)}${pct}%${RST}`;
}

const PLAN_PRICES: Record<string, number> = { Max: 200, Pro: 20, Team: 30 };

function buildCostParts(config: DisplayConfig, usage: StatusLineUsage | null, quota: QuotaData | null): string[] {
  const parts: string[] = [];
  if (!usage) return parts;

  if (config.showToday) {
    parts.push(`${C.dim}Today${S}${C.costBig}${fmtCost(usage.todayCostUSD)}${RST}`);
  }
  if (config.showWeek) {
    parts.push(`${C.dim}Week${S}${C.costBig}${fmtCost(usage.weekCostUSD)}${RST}`);
  }
  if (config.showMonth) {
    parts.push(`${C.dim}Month${S}${C.costBig}${fmtCost(usage.monthCostUSD)}${RST}`);
  }
  if (config.showSaving) {
    const price = PLAN_PRICES[quota?.planName || ''] ?? 0;
    if (price > 0) {
      const saving = usage.monthCostUSD - price;
      if (saving > 0) {
        parts.push(`${C.dim}Monthly${S}Saving${S}${C.active}+${fmtCost(saving)}${RST}`);
      }
    }
  }
  return parts;
}

// --- Part builders: Transcript activity ---

function renderToolsLine(tools: ToolEntry[]): string | null {
  if (tools.length === 0) return null;

  const parts: string[] = [];
  const running = tools.filter(t => t.status === 'running');
  const completed = tools.filter(t => t.status === 'completed' || t.status === 'error');

  // Up to 2 running tools with target
  for (const t of running.slice(-2)) {
    const target = t.target ? truncatePath(t.target) : '';
    parts.push(`${C.idle}\u25D0${RST}${S}${C.tool}${t.name}${target ? `${C.dim}:${S}${target}` : ''}${RST}`);
  }

  // Top 4 completed by frequency
  const counts = new Map<string, number>();
  for (const t of completed) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4);
  for (const [name, count] of sorted) {
    parts.push(`${C.active}\u2713${RST}${S}${name}${S}${C.dim}\u00D7${count}${RST}`);
  }

  return parts.length > 0 ? parts.join(`${S}${C.dimmer}|${RST}${S}`) : null;
}

function renderAgentLines(agents: AgentEntry[]): string[] {
  const running = agents.filter(a => a.status === 'running');
  const recent = agents.filter(a => a.status === 'completed' || a.status === 'error').slice(-2);
  const toShow = [...running, ...recent].slice(-3);

  const lines: string[] = [];
  for (const a of toShow) {
    const icon = a.status === 'running'
      ? `${C.idle}\u25D0${RST}`
      : a.status === 'error'
      ? `${C.urgent}\u2717${RST}`
      : `${C.active}\u2713${RST}`;
    const type = `${C.sub}${a.type}${RST}`;
    const model = a.model ? `${S}${C.dim}[${a.model}]${RST}` : '';
    const desc = a.description ? `${C.dim}:${S}${truncate(a.description)}${RST}` : '';
    const elapsed = formatElapsed(a);
    lines.push(`${icon}${S}${type}${model}${desc}${S}${C.dim}(${elapsed})${RST}`);
  }
  return lines;
}

function renderTodosLine(todos: TodoEntry[]): string | null {
  if (todos.length === 0) return null;

  const inProgress = todos.find(t => t.status === 'in_progress');
  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;

  if (inProgress) {
    const content = truncate(inProgress.content, 50);
    return `${C.idle}\u25B8${RST}${S}${content}${S}${C.dim}(${completed}/${total})${RST}`;
  }
  if (completed === total && total > 0) {
    return `${C.active}\u2713${RST}${S}All${S}todos${S}complete${S}${C.dim}(${completed}/${total})${RST}`;
  }
  if (completed > 0) {
    return `${C.done}\u2713${S}${C.dim}Tasks${S}${completed}/${total}${RST}`;
  }
  return null;
}

// --- Main renderer ---

export function render(
  stdin: StdinData,
  quota: QuotaData | null,
  usage: StatusLineUsage | null,
  config: DisplayConfig,
  transcript?: TranscriptData | null,
): string {
  const lines: string[] = [];
  const join = `${S}${S}`;
  const pipe = `${S}${C.dimmer}|${RST}${S}`;

  // Quota & context parts
  const plan = buildPlanPart(config, quota);
  const q5h = config.showQuota5h ? buildQuotaPart('5h', quota?.fiveHour) : null;
  const q7d = config.showQuota7d ? buildQuotaPart('7d', quota?.sevenDay) : null;
  const ctx = buildContextPart(config, stdin);
  const costs = buildCostParts(config, usage, quota);

  // Line 1: Plan + Costs (pipe-separated)
  const costLine = [plan, ...costs].filter(Boolean) as string[];
  if (costLine.length > 0) lines.push(costLine.join(pipe));
  // Line 2: Quotas + Context (space-separated)
  const quotaLine = [q5h, q7d, ctx].filter(Boolean) as string[];
  if (quotaLine.length > 0) lines.push(quotaLine.join(join));

  // Transcript activity
  if (transcript) {
    if (config.showTools) {
      const toolLine = renderToolsLine(transcript.tools);
      if (toolLine) lines.push(toolLine);
    }

    if (config.showAgents) {
      lines.push(...renderAgentLines(transcript.agents));
    }

    if (config.showTodos) {
      const todoLine = renderTodosLine(transcript.todos);
      if (todoLine) lines.push(todoLine);
    }
  }

  // Fallback
  if (lines.length === 0 && stdin.modelName) {
    lines.push(`${C.model}${stdin.modelName}${RST}`);
  }

  return lines.join('\n');
}

/** @internal — exported for unit testing only */
export const _test = {
  quotaColor, dotBar, fmtCost, truncatePath, truncate, formatElapsed,
  buildPlanPart, buildQuotaPart, buildContextPart, buildCostParts,
  renderToolsLine, renderAgentLines, renderTodosLine,
};
