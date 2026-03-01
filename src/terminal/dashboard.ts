import type { AgentState, AgentActivity, AgentStatus, ContextUsage, ToolAction, UsageSummary, TokenBucket, QuotaData } from '../data/types.js';

const E = '\x1b';
const R = `${E}[0m`;
const B = `${E}[1m`;
const DIM = `${E}[2m`;
const c = (r: number, g: number, b: number) => `${E}[38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `${E}[48;2;${r};${g};${b}m`;

const C = {
  active:  c(74, 222, 128),
  urgent:  c(255, 120, 100),
  done:    c(90, 85, 75),
  idle:    c(250, 204, 21),
  dim:     c(90, 85, 75),
  dimmer:  c(55, 52, 45),
  text:    c(180, 175, 165),
  bright:  c(220, 215, 205),
  accent:  c(100, 160, 230),
  sub:     c(160, 140, 200),
  model:   c(140, 120, 200),
  cost:    c(120, 200, 180),
  costBig: c(240, 180, 80),
  ctxOk:   c(80, 200, 140),
  ctxWarn: c(250, 180, 50),
  ctxCrit: c(240, 80, 80),
  border:  c(50, 46, 38),
  bgDark:  bg(22, 20, 18),
  bgAct:   bg(26, 34, 24),
  bgUrgent: bg(38, 22, 20),
  bgDone:  bg(24, 22, 20),
  bgIdle:  bg(34, 32, 22),
};

const ICON_WORK = '⠿';
const ICON_URGENT = '‼';
const ICON_DONE = '✓';
const ICON_IDLE = '○';

// Regex to strip ANSI escape sequences for visible length calculation
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// --- Helpers ---

function ago(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'now';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fit(s: string, w: number): string {
  if (w <= 0) return '';
  if (!s) return ' '.repeat(w);
  if (s.length > w) return s.slice(0, w - 1) + '…';
  return s + ' '.repeat(w - s.length);
}

function fmtStatus(status: AgentStatus): string {
  switch (status.state) {
    case 'calling_tool': return 'working...';
    case 'thinking':     return 'thinking...';
    case 'responding':   return 'responding...';
    case 'needs_response': return 'needs response';
    case 'waiting_input': return 'done';
    case 'done':         return 'done';
    case 'idle':         return 'idle';
    case 'sleeping':     return 'sleeping';
  }
}

function isWorking(status: AgentStatus): boolean {
  return status.state === 'calling_tool' || status.state === 'thinking' || status.state === 'responding';
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}

function fmtCost(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 1) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

function ctxPctStr(pct: number): string {
  const col = pct >= 90 ? C.ctxCrit : pct >= 70 ? C.ctxWarn : C.ctxOk;
  return `${col}${pct}%`;
}

function quotaColor(pct: number): string {
  if (pct >= 90) return C.ctxCrit;
  if (pct >= 75) return C.ctxWarn;
  return C.sub;
}

function quotaBar(pct: number, width: number = 10): string {
  const safe = Math.max(0, Math.min(100, pct));
  const filled = Math.round((safe / 100) * width);
  const empty = width - filled;
  const col = quotaColor(safe);
  return `${col}${'█'.repeat(filled)}${C.dimmer}${'░'.repeat(empty)}${R}`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return '';
  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return '';
  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
}

function fmtBucket(label: string, cost: number, bucket: TokenBucket): string {
  const costColor = cost > 100 ? C.costBig : C.cost;
  const out = fmtTokens(bucket.outputTokens);
  const inp = fmtTokens(bucket.inputTokens);
  const cache = fmtTokens(bucket.cacheWriteTokens + bucket.cacheReadTokens);
  return `${C.bgDark}  ${C.dim}${fit(label, 5)} ${costColor}${fmtCost(cost)}  ${C.dimmer}out:${C.dim}${out} in:${inp} cache:${cache}${R}`;
}

// --- Renderer ---

export class DashboardRenderer {
  private prevLines: string[] = [];

  render(agents: AgentState[], cols: number, rows: number, _scroll: number, _focusIdx: number, usage?: UsageSummary | null, quota?: QuotaData | null): string {
    const o: string[] = [];
    const W = cols;
    const lines: string[] = [];

    // Auto-pad: ensures every line is exactly W visible chars wide.
    // Inserts padding BEFORE the trailing reset so it inherits the active background.
    // This prevents lines from being wider than the terminal (which causes wrapping/flickering).
    const ln = (y: number, raw: string) => {
      const endsWithReset = raw.endsWith(R);
      const base = endsWithReset ? raw.slice(0, -R.length) : raw;
      const visChars = base.replace(ANSI_RE, '').length;
      const deficit = W - visChars;
      if (deficit > 0) {
        lines[y - 1] = base + ' '.repeat(deficit) + R;
      } else {
        lines[y - 1] = raw;
      }
    };

    let y = 1;

    // ╔══════════════════════════════════════╗
    // ║  TITLE: Claude Office                ║
    // ╚══════════════════════════════════════╝

    ln(y, `${C.bgDark} ${B}${C.bright}Claude Office${R}${C.bgDark} ${C.border}${'─'.repeat(Math.max(0, W - 16))}${R}`);
    y++;

    // ╔══════════════════════════════════════╗
    // ║  INFO SECTION (fixed 6 lines)        ║
    // ╚══════════════════════════════════════╝
    // Always render all 6 info lines at fixed positions.

    // Line: Plan
    const planName = quota?.planName || (usage ? usage.plan.toUpperCase() : null);
    if (planName) {
      const planPrice = usage ? fmtCost(usage.planPriceUSD) : null;
      const priceStr = planPrice ? ` ${C.dimmer}${planPrice}/mo` : '';
      const saved = usage ? usage.monthEstimatedCostUSD - usage.planPriceUSD : 0;
      const savedStr = saved > 0 ? `  ${C.active}saving ${fmtCost(saved)}` : '';
      ln(y, `${C.bgDark}  ${C.model}${B}${planName}${R}${C.bgDark}${priceStr}${savedStr}${R}`);
    } else {
      ln(y, `${C.bgDark}${R}`);
    }
    y++;

    // Line: 5h window
    if (quota && quota.fiveHour != null) {
      const pct = quota.fiveHour;
      const resetStr = formatResetTime(quota.fiveHourResetAt);
      if (pct >= 100) {
        ln(y, `${C.bgDark}  ${C.ctxCrit}5h  ⚠ limit reached${resetStr ? `  resets ${resetStr}` : ''}${R}`);
      } else {
        const timeStr = resetStr ? `${C.dimmer}resets ${resetStr}` : '';
        ln(y, `${C.bgDark}  ${C.dim}5h  ${quotaBar(pct)} ${quotaColor(pct)}${pct}%  ${timeStr}${R}`);
      }
    } else if (quota?.apiUnavailable && quota.apiError) {
      ln(y, `${C.bgDark}  ${C.dimmer}5h  ${C.ctxWarn}⚠ ${C.dimmer}(${quota.apiError})${R}`);
    } else {
      ln(y, `${C.bgDark}  ${C.dimmer}5h  ─${R}`);
    }
    y++;

    // Line: 7d window
    if (quota && quota.sevenDay != null) {
      const pct = quota.sevenDay;
      const resetStr = formatResetTime(quota.sevenDayResetAt);
      if (pct >= 100) {
        ln(y, `${C.bgDark}  ${C.ctxCrit}7d  ⚠ limit reached${resetStr ? `  resets ${resetStr}` : ''}${R}`);
      } else {
        const timeStr = resetStr ? `${C.dimmer}resets ${resetStr}` : '';
        ln(y, `${C.bgDark}  ${C.dim}7d  ${quotaBar(pct)} ${quotaColor(pct)}${pct}%  ${timeStr}${R}`);
      }
    } else {
      ln(y, `${C.bgDark}  ${C.dimmer}7d  ─${R}`);
    }
    y++;

    // Lines: Today / Week / Month (always render all 3 with real data)
    if (usage) {
      ln(y, fmtBucket('Today', usage.todayEstimatedCostUSD, usage.today)); y++;
      ln(y, fmtBucket('Week', usage.weekEstimatedCostUSD, usage.week)); y++;
      ln(y, fmtBucket('Month', usage.monthEstimatedCostUSD, usage.month)); y++;
    } else {
      ln(y, `${C.bgDark}  ${C.dimmer}Today ─${R}`); y++;
      ln(y, `${C.bgDark}  ${C.dimmer}Week  ─${R}`); y++;
      ln(y, `${C.bgDark}  ${C.dimmer}Month ─${R}`); y++;
    }

    // ╔══════════════════════════════════════╗
    // ║  WORKS SECTION                       ║
    // ╚══════════════════════════════════════╝

    // Categorize
    const workingAgents: AgentState[] = [];
    const urgentAgents: AgentState[] = [];
    const doneAgents: AgentState[] = [];
    const idleAgents: AgentState[] = [];
    const live: AgentState[] = [];
    let totalSubs = 0;
    for (const a of agents) {
      totalSubs += a.subAgents.length;
      if (a.activity !== 'sleeping') live.push(a);
      switch (a.status.state) {
        case 'calling_tool': case 'thinking': case 'responding':
          workingAgents.push(a); break;
        case 'needs_response':
          urgentAgents.push(a); break;
        case 'done': case 'waiting_input':
          doneAgents.push(a); break;
        case 'idle':
          idleAgents.push(a); break;
      }
    }

    // Works header with summary counts
    const counts: string[] = [];
    if (urgentAgents.length > 0) counts.push(`${C.urgent}${ICON_URGENT}${urgentAgents.length}`);
    if (workingAgents.length > 0) counts.push(`${C.active}${ICON_WORK}${workingAgents.length}`);
    if (doneAgents.length > 0) counts.push(`${C.done}${ICON_DONE}${doneAgents.length}`);
    if (idleAgents.length > 0) counts.push(`${C.idle}${ICON_IDLE}${idleAgents.length}`);
    if (totalSubs > 0) counts.push(`${C.sub}${totalSubs} sub`);
    const countsStr = counts.join(`${C.dimmer} `);
    const worksFill = Math.max(0, W - 8);

    ln(y, `${C.bgDark} ${B}${C.bright}Works${R}${C.bgDark} ${C.border}${'─'.repeat(Math.max(0, worksFill - counts.length * 3 - 2))} ${countsStr}${R}`);
    y++;

    // Agent list
    const CTX_W = 5;

    if (live.length === 0) {
      ln(y, `${C.bgDark}  ${C.dim}No active agents${R}`);
      y++;
    }

    for (const a of live) {
      if (y > rows - 2) break;
      const working = isWorking(a.status);
      const isUrgent = a.status.state === 'needs_response';
      const isDone = a.status.state === 'done' || a.status.state === 'waiting_input';
      const rowBg = working ? C.bgAct : isUrgent ? C.bgUrgent : isDone ? C.bgDone : C.bgIdle;
      const col = working ? C.active : isUrgent ? C.urgent : isDone ? C.done : C.idle;
      const icon = working ? ICON_WORK : isUrgent ? ICON_URGENT : isDone ? ICON_DONE : ICON_IDLE;

      const nameStr = a.name;
      const timeStr = ago(a.lastActive);
      const statusText = fmtStatus(a.status);
      const ctx = a.context;
      const ctxStr = ctx ? ctxPctStr(ctx.contextPercent) : '';
      const ctxPlainLen = ctx ? `${ctx.contextPercent}%`.length : 0;
      const ctxPad = CTX_W - ctxPlainLen;
      const leftPlain = 3 + nameStr.length + 1 + ctxPlainLen + ctxPad + timeStr.length + 2;
      const statusW = Math.max(0, W - leftPlain);

      ln(y, `${rowBg}${col} ${icon} ${B}${C.bright}${nameStr}${R}${rowBg} ${ctxStr}${R}${rowBg}${' '.repeat(ctxPad)}${col}${timeStr}${R}${rowBg}  ${C.dim}${fit(statusText, statusW)}${R}`);
      y++;

      // Sub-agents
      for (let si = 0; si < a.subAgents.length; si++) {
        if (y > rows - 2) break;
        const sub = a.subAgents[si];
        const subWorking = isWorking(sub.status);
        const subUrgent = sub.status.state === 'needs_response';
        const subDone = sub.status.state === 'done' || sub.status.state === 'waiting_input';
        const subCol = subWorking ? C.active : subUrgent ? C.urgent : subDone ? C.done : C.idle;
        const isLast = si === a.subAgents.length - 1;
        const tree = isLast ? '└' : '├';
        const subIcon = subWorking ? ICON_WORK : subUrgent ? ICON_URGENT : subDone ? ICON_DONE : ICON_IDLE;
        const subStatusText = fmtStatus(sub.status);
        const subCtx = sub.context;
        const subCtxStr = subCtx ? ctxPctStr(subCtx.contextPercent) : '';
        const subCtxPlainLen = subCtx ? `${subCtx.contextPercent}%`.length : 0;
        const subCtxPad = CTX_W - subCtxPlainLen;
        const subNameW = Math.min(sub.name.length, 18);
        const subLeftPlain = 5 + subNameW + 1 + subCtxPlainLen + subCtxPad;
        const subStatusW = Math.max(0, W - subLeftPlain);

        ln(y, `${rowBg}${C.dimmer}   ${tree}${subCol}${subIcon} ${C.sub}${fit(sub.name, subNameW)}${R}${rowBg} ${subCtxStr}${R}${rowBg}${' '.repeat(subCtxPad)}${C.dim}${fit(subStatusText, subStatusW)}${R}`);
        y++;
      }
    }

    // Fill remaining
    while (y <= rows - 1) {
      ln(y, `${C.bgDark}${R}`);
      y++;
    }

    // Footer
    ln(rows, `${C.bgDark}${C.border}─${C.dim} q:quit ${C.border}${'─'.repeat(Math.max(0, W - 9))}${R}`);

    // Virtual buffer diff
    const prev = this.prevLines;
    const sameSize = prev.length === rows;
    for (let i = 0; i < rows; i++) {
      const line = lines[i] ?? '';
      if (sameSize && prev[i] === line) continue;
      o.push(`${E}[${i + 1};1H${line}${E}[K`);
    }
    this.prevLines = lines;
    return o.join('');
  }
}
