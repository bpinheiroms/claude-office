/**
 * Compact multi-line renderer for the statusline.
 * Outputs 2 lines:
 *   Line 1: Quota bars + cost summary
 *   Line 2: Agent status icons
 *
 * Uses \u00A0 (non-breaking space) to prevent whitespace collapsing.
 */

import type { StdinData } from './stdin.js';
import type { StatusLineAgent } from './agent-scanner.js';
import type { StatusLineUsage } from './usage-scanner.js';
import type { QuotaData } from '../data/types.js';

const S = '\u00A0';  // non-breaking space

// --- ANSI helpers ---
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
  cost:    c(120, 200, 180),
  costBig: c(240, 180, 80),
  ctxOk:   c(80, 200, 140),
  ctxWarn: c(250, 180, 50),
  ctxCrit: c(240, 80, 80),
  sub:     c(160, 140, 200),
};

const ICON_WORK = '\u283F';    // ⠿ (braille dots-123456)
const ICON_URGENT = '\u203C';  // ‼
const ICON_DONE = '\u2713';    // ✓
const ICON_IDLE = '\u25CB';    // ○

// --- Helpers ---

function quotaColor(pct: number): string {
  if (pct >= 90) return C.ctxCrit;
  if (pct >= 75) return C.ctxWarn;
  return C.sub;
}

function quotaBar(pct: number, width: number = 10): string {
  const safe = Math.max(0, Math.min(100, pct));
  const filled = Math.round((safe / 100) * width);
  const empty = width - filled;
  return `${quotaColor(safe)}${'\u2588'.repeat(filled)}${C.dimmer}${'\u2591'.repeat(empty)}${RST}`;
}

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

function ctxPctColor(pct: number): string {
  if (pct >= 90) return C.ctxCrit;
  if (pct >= 70) return C.ctxWarn;
  return C.ctxOk;
}

function statusColor(status: StatusLineAgent['status']): string {
  switch (status) {
    case 'working': case 'thinking': case 'responding': return C.active;
    case 'needs_response': return C.urgent;
    case 'done': return C.done;
    case 'idle': return C.idle;
  }
}

function statusIcon(status: StatusLineAgent['status']): string {
  switch (status) {
    case 'working': case 'thinking': case 'responding': return ICON_WORK;
    case 'needs_response': return ICON_URGENT;
    case 'done': return ICON_DONE;
    case 'idle': return ICON_IDLE;
  }
}

function statusText(status: StatusLineAgent['status']): string {
  switch (status) {
    case 'working': return 'working';
    case 'thinking': return 'thinking';
    case 'responding': return 'responding';
    case 'needs_response': return 'needs\u00A0response';
    case 'done': return 'done';
    case 'idle': return 'idle';
  }
}

// --- Renderer ---

export function render(
  stdin: StdinData,
  quota: QuotaData | null,
  agents: StatusLineAgent[],
  usage: StatusLineUsage | null,
): string {
  const lines: string[] = [];

  // --- Line 1: Quota + Costs ---
  const parts1: string[] = [];

  // Plan name
  const planName = quota?.planName || '';
  if (planName) {
    parts1.push(`${BOLD}${C.model}${planName}${RST}`);
  }

  // 5h quota
  if (quota && quota.fiveHour != null) {
    const pct = quota.fiveHour;
    if (pct >= 100) {
      parts1.push(`${C.dim}5h${S}${C.ctxCrit}LIMIT${RST}`);
    } else {
      parts1.push(`${C.dim}5h${S}${quotaBar(pct)}${S}${quotaColor(pct)}${pct}%${RST}`);
    }
  }

  // 7d quota
  if (quota && quota.sevenDay != null) {
    const pct = quota.sevenDay;
    if (pct >= 100) {
      parts1.push(`${C.dim}7d${S}${C.ctxCrit}LIMIT${RST}`);
    } else {
      parts1.push(`${C.dim}7d${S}${quotaBar(pct)}${S}${quotaColor(pct)}${pct}%${RST}`);
    }
  }

  // Costs
  if (usage) {
    const todayCol = usage.todayCostUSD > 100 ? C.costBig : C.cost;
    const weekCol = usage.weekCostUSD > 100 ? C.costBig : C.cost;
    parts1.push(`${C.dim}Today${S}${todayCol}${fmtCost(usage.todayCostUSD)}${RST}`);
    parts1.push(`${C.dim}Week${S}${weekCol}${fmtCost(usage.weekCostUSD)}${RST}`);
  }

  if (parts1.length > 0) {
    lines.push(parts1.join(`${S}${S}`));
  }

  // --- Line 2: Agents ---
  const activeAgents = agents.filter(a => a.status !== 'done' || agents.length <= 5);
  // If many agents, limit to most relevant
  const shown = activeAgents.slice(0, 8);

  if (shown.length > 0) {
    const agentParts: string[] = [];
    for (const a of shown) {
      const col = statusColor(a.status);
      const icon = statusIcon(a.status);
      const ctx = a.contextPercent > 0
        ? `${S}${ctxPctColor(a.contextPercent)}${a.contextPercent}%`
        : '';
      agentParts.push(`${col}${icon}${S}${C.bright}${a.name}${ctx}${S}${col}${statusText(a.status)}${RST}`);
    }
    lines.push(agentParts.join(`${S}${S}`));
  }

  // If no lines at all, show minimal context info from stdin
  if (lines.length === 0 && stdin.modelName) {
    lines.push(`${C.model}${stdin.modelName}${RST}`);
  }

  return lines.join('\n');
}
