/**
 * Single-line statusline renderer.
 * Shows: Plan | 5h quota | 7d quota | Today | Week | Month
 *
 * Uses \u00A0 (non-breaking space) to prevent whitespace collapsing.
 */

import type { StdinData } from './stdin.js';
import type { StatusLineUsage } from './usage-scanner.js';
import type { QuotaData } from '../data/types.js';

const S = '\u00A0';  // non-breaking space

// --- ANSI helpers ---
const E = '\x1b';
const RST = `${E}[0m`;
const BOLD = `${E}[1m`;
const c = (r: number, g: number, b: number) => `${E}[38;2;${r};${g};${b}m`;

const C = {
  dim:     c(90, 85, 75),
  dimmer:  c(55, 52, 45),
  model:   c(140, 120, 200),
  cost:    c(120, 200, 180),
  costBig: c(240, 180, 80),
  ctxWarn: c(250, 180, 50),
  ctxCrit: c(240, 80, 80),
  sub:     c(160, 140, 200),
};

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

// --- Renderer ---

export function render(
  stdin: StdinData,
  quota: QuotaData | null,
  usage: StatusLineUsage | null,
): string {
  const parts: string[] = [];

  // Plan name
  const planName = quota?.planName || '';
  if (planName) {
    parts.push(`${BOLD}${C.model}${planName}${RST}`);
  }

  // 5h quota
  if (quota && quota.fiveHour != null) {
    const pct = quota.fiveHour;
    if (pct >= 100) {
      parts.push(`${C.dim}5h${S}${C.ctxCrit}LIMIT${RST}`);
    } else {
      parts.push(`${C.dim}5h${S}${quotaBar(pct)}${S}${quotaColor(pct)}${pct}%${RST}`);
    }
  } else if (quota?.apiUnavailable && quota.planName) {
    parts.push(`${C.dimmer}5h${S}--${RST}`);
  }

  // 7d quota
  if (quota && quota.sevenDay != null) {
    const pct = quota.sevenDay;
    if (pct >= 100) {
      parts.push(`${C.dim}7d${S}${C.ctxCrit}LIMIT${RST}`);
    } else {
      parts.push(`${C.dim}7d${S}${quotaBar(pct)}${S}${quotaColor(pct)}${pct}%${RST}`);
    }
  } else if (quota?.apiUnavailable && quota.planName) {
    parts.push(`${C.dimmer}7d${S}--${RST}`);
  }

  // Costs: Today | Week | Month
  if (usage) {
    const todayCol = usage.todayCostUSD > 100 ? C.costBig : C.cost;
    const weekCol = usage.weekCostUSD > 100 ? C.costBig : C.cost;
    const monthCol = usage.monthCostUSD > 500 ? C.costBig : C.cost;
    parts.push(`${C.dim}Today${S}${todayCol}${fmtCost(usage.todayCostUSD)}${RST}`);
    parts.push(`${C.dim}Week${S}${weekCol}${fmtCost(usage.weekCostUSD)}${RST}`);
    parts.push(`${C.dim}Month${S}${monthCol}${fmtCost(usage.monthCostUSD)}${RST}`);
  }

  // Fallback
  if (parts.length === 0 && stdin.modelName) {
    parts.push(`${C.model}${stdin.modelName}${RST}`);
  }

  return parts.join(`${S}${S}`);
}
