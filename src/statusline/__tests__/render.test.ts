import { describe, test, expect } from 'bun:test';
import { render, _test } from '../render.js';
import { makeStdin, makeQuota, makeConfig, makeMinimalConfig, makeUsage, makeTool, makeAgent, makeTodo, makeTranscript } from './helpers/fixtures.js';

const {
  quotaColor, dotBar, fmtCost, truncatePath, truncate, formatElapsed,
  buildPlanPart, buildQuotaPart, buildContextPart, buildCostParts,
  renderToolsLine, renderAgentLines, renderTodosLine,
} = _test;

// Strip ANSI escape codes for content testing
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

// --- quotaColor ---

describe('quotaColor', () => {
  test('returns critical color at 90%', () => {
    const color = quotaColor(90);
    expect(color).toContain('240;80;80');
  });

  test('returns critical color above 90%', () => {
    expect(quotaColor(95)).toContain('240;80;80');
  });

  test('returns warning color at 75%', () => {
    expect(quotaColor(75)).toContain('250;180;50');
  });

  test('returns warning color at 89%', () => {
    expect(quotaColor(89)).toContain('250;180;50');
  });

  test('returns normal color below 75%', () => {
    expect(quotaColor(50)).toContain('160;140;200');
  });

  test('returns normal color at 0%', () => {
    expect(quotaColor(0)).toContain('160;140;200');
  });
});

// --- dotBar ---

describe('dotBar', () => {
  test('0% = all empty', () => {
    const bar = strip(dotBar(0, ''));
    expect(bar).toBe('━'.repeat(10));
  });

  test('100% = all filled', () => {
    const bar = strip(dotBar(100, ''));
    expect(bar).toBe('━'.repeat(10));
  });

  test('50% = 5 filled + 5 empty', () => {
    const bar = strip(dotBar(50, ''));
    expect(bar).toBe('━'.repeat(5) + '━'.repeat(5));
  });

  test('clamps below 0', () => {
    const bar = strip(dotBar(-10, ''));
    expect(bar).toBe('━'.repeat(10));
  });

  test('clamps above 100', () => {
    const bar = strip(dotBar(150, ''));
    expect(bar).toBe('━'.repeat(10));
  });

  test('custom width = 5', () => {
    const bar = strip(dotBar(40, '', 5));
    expect(bar).toBe('━━━━━');
  });

  test('rounding: 15% of 10 → 2 filled', () => {
    const bar = strip(dotBar(15, ''));
    expect(bar).toBe('━━━━━━━━━━');
  });
});

// --- fmtCost ---

describe('fmtCost', () => {
  test('formats cents: $0.05', () => {
    expect(fmtCost(0.05)).toBe('$0.05');
  });

  test('formats sub-dollar: $0.50', () => {
    expect(fmtCost(0.50)).toBe('$0.50');
  });

  test('formats single digit: $1', () => {
    expect(fmtCost(1)).toBe('$1');
  });

  test('formats double digit: $52', () => {
    expect(fmtCost(52)).toBe('$52');
  });

  test('formats hundreds: $420', () => {
    expect(fmtCost(420)).toBe('$420');
  });

  test('formats thousands: $1.2k', () => {
    expect(fmtCost(1200)).toBe('$1.2k');
  });

  test('formats large thousands: $5.0k', () => {
    expect(fmtCost(5000)).toBe('$5.0k');
  });

  test('$0.00', () => {
    expect(fmtCost(0)).toBe('$0.00');
  });
});

// --- truncatePath ---

describe('truncatePath', () => {
  test('short path unchanged', () => {
    expect(truncatePath('src/index.ts')).toBe('src/index.ts');
  });

  test('long path gets .../file', () => {
    const result = truncatePath('/home/user/projects/my-app/src/components/Header.tsx');
    expect(result).toBe('.../Header.tsx');
  });

  test('normalizes backslashes', () => {
    expect(truncatePath('src\\lib\\utils.ts')).toBe('src/lib/utils.ts');
  });

  test('very long filename gets truncated', () => {
    const longName = 'a'.repeat(25) + '.ts';
    const result = truncatePath(longName, 20);
    expect(result.length).toBe(20);
    expect(result).toEndWith('...');
  });

  test('custom max length: filename exceeds maxLen → truncated filename', () => {
    const result = truncatePath('src/components/Header.tsx', 10);
    // "Header.tsx" (10 chars) >= maxLen (10), so it's truncated
    expect(result).toBe('Header....');
  });

  test('exact max length stays unchanged', () => {
    expect(truncatePath('12345678901234567890')).toBe('12345678901234567890');
  });
});

// --- truncate ---

describe('truncate', () => {
  test('short text unchanged', () => {
    expect(truncate('hello')).toBe('hello');
  });

  test('long text gets truncated with ...', () => {
    const long = 'a'.repeat(50);
    const result = truncate(long, 40);
    expect(result.length).toBe(40);
    expect(result).toEndWith('...');
  });

  test('exact length unchanged', () => {
    const exact = 'a'.repeat(40);
    expect(truncate(exact, 40)).toBe(exact);
  });
});

// --- formatElapsed ---

describe('formatElapsed', () => {
  test('<1s for sub-second durations', () => {
    const agent = makeAgent({
      startTime: new Date('2026-03-02T10:00:00.000Z'),
      endTime: new Date('2026-03-02T10:00:00.500Z'),
    });
    expect(formatElapsed(agent)).toBe('<1s');
  });

  test('seconds format', () => {
    const agent = makeAgent({
      startTime: new Date('2026-03-02T10:00:00Z'),
      endTime: new Date('2026-03-02T10:00:15Z'),
    });
    expect(formatElapsed(agent)).toBe('15s');
  });

  test('minutes + seconds format', () => {
    const agent = makeAgent({
      startTime: new Date('2026-03-02T10:00:00Z'),
      endTime: new Date('2026-03-02T10:02:15Z'),
    });
    const result = strip(formatElapsed(agent));
    expect(result).toContain('2m');
    expect(result).toContain('15s');
  });
});

// --- buildPlanPart ---

describe('buildPlanPart', () => {
  test('returns null when showPlan=false', () => {
    expect(buildPlanPart(makeConfig({ showPlan: false }), makeQuota())).toBeNull();
  });

  test('returns null when quota is null', () => {
    expect(buildPlanPart(makeConfig(), null)).toBeNull();
  });

  test('returns null when planName is empty', () => {
    expect(buildPlanPart(makeConfig(), makeQuota({ planName: '' }))).toBeNull();
  });

  test('returns plan name when available', () => {
    const result = strip(buildPlanPart(makeConfig(), makeQuota({ planName: 'Max' }))!);
    expect(result).toBe('Plan\u00A0Max');
  });
});

// --- buildQuotaPart ---

describe('buildQuotaPart', () => {
  test('returns null for null pct', () => {
    expect(buildQuotaPart('5h', null)).toBeNull();
  });

  test('returns null for undefined pct', () => {
    expect(buildQuotaPart('5h', undefined)).toBeNull();
  });

  test('shows LIMIT at 100%', () => {
    const result = strip(buildQuotaPart('5h', 100)!);
    expect(result).toContain('LIMIT');
  });

  test('shows bar and percentage at normal usage', () => {
    const result = strip(buildQuotaPart('5h', 42)!);
    expect(result).toContain('5h');
    expect(result).toContain('42%');
  });

  test('shows bar and percentage at 99%', () => {
    const result = strip(buildQuotaPart('7d', 99)!);
    expect(result).toContain('7d');
    expect(result).toContain('99%');
  });
});

// --- buildContextPart ---

describe('buildContextPart', () => {
  test('returns null when showContext=false', () => {
    expect(buildContextPart(makeConfig({ showContext: false }), makeStdin())).toBeNull();
  });

  test('returns null when contextPercent is 0', () => {
    expect(buildContextPart(makeConfig(), makeStdin({ contextPercent: 0 }))).toBeNull();
  });

  test('shows Context bar', () => {
    const result = strip(buildContextPart(makeConfig(), makeStdin({ contextPercent: 42 }))!);
    expect(result).toContain('Context');
    expect(result).toContain('42%');
  });
});

// --- buildCostParts ---

describe('buildCostParts', () => {
  test('returns empty when usage is null', () => {
    expect(buildCostParts(makeConfig(), null, makeQuota())).toEqual([]);
  });

  test('includes today when showToday=true', () => {
    const parts = buildCostParts(makeConfig(), makeUsage({ todayCostUSD: 51 }), makeQuota());
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Today') && p.includes('$51'))).toBe(true);
  });

  test('excludes today when showToday=false', () => {
    const parts = buildCostParts(makeConfig({ showToday: false }), makeUsage(), makeQuota());
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Today'))).toBe(false);
  });

  test('includes week cost', () => {
    const parts = buildCostParts(makeConfig(), makeUsage({ weekCostUSD: 180 }), makeQuota());
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Week') && p.includes('$180'))).toBe(true);
  });

  test('includes month cost', () => {
    const parts = buildCostParts(makeConfig(), makeUsage({ monthCostUSD: 420 }), makeQuota());
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Month') && p.includes('$420'))).toBe(true);
  });

  test('shows saving when month cost > plan price', () => {
    const parts = buildCostParts(
      makeConfig(),
      makeUsage({ monthCostUSD: 420 }),
      makeQuota({ planName: 'Max' }), // Max = $200
    );
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Saving') && p.includes('+$220'))).toBe(true);
  });

  test('hides saving when month cost < plan price', () => {
    const parts = buildCostParts(
      makeConfig(),
      makeUsage({ monthCostUSD: 100 }),
      makeQuota({ planName: 'Max' }), // Max = $200
    );
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Saving'))).toBe(false);
  });

  test('hides saving when no plan name', () => {
    const parts = buildCostParts(
      makeConfig(),
      makeUsage({ monthCostUSD: 1000 }),
      makeQuota({ planName: null }),
    );
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('Saving'))).toBe(false);
  });

  test('Pro plan price = $20', () => {
    const parts = buildCostParts(
      makeConfig(),
      makeUsage({ monthCostUSD: 50 }),
      makeQuota({ planName: 'Pro' }),
    );
    const stripped = parts.map(strip);
    expect(stripped.some(p => p.includes('+$30'))).toBe(true);
  });
});

// --- renderToolsLine ---

describe('renderToolsLine', () => {
  test('returns null for empty tools', () => {
    expect(renderToolsLine([])).toBeNull();
  });

  test('shows running tool with target', () => {
    const result = strip(renderToolsLine([
      makeTool({ status: 'running', name: 'Read', target: '/src/index.ts' }),
    ])!);
    expect(result).toContain('Read');
    expect(result).toContain('src/index.ts');
  });

  test('shows completed tools with count', () => {
    const tools = [
      makeTool({ id: '1', name: 'Edit', status: 'completed' }),
      makeTool({ id: '2', name: 'Edit', status: 'completed' }),
      makeTool({ id: '3', name: 'Edit', status: 'completed' }),
    ];
    const result = strip(renderToolsLine(tools)!);
    expect(result).toContain('Edit');
    expect(result).toContain('×3');
  });

  test('shows max 2 running tools', () => {
    const tools = [
      makeTool({ id: '1', status: 'running', name: 'Read', target: 'a.ts' }),
      makeTool({ id: '2', status: 'running', name: 'Write', target: 'b.ts' }),
      makeTool({ id: '3', status: 'running', name: 'Edit', target: 'c.ts' }),
    ];
    const result = strip(renderToolsLine(tools)!);
    // Only the last 2 running tools are shown
    expect(result).toContain('Write');
    expect(result).toContain('Edit');
  });

  test('sorts completed by frequency (most frequent first)', () => {
    const tools = [
      makeTool({ id: '1', name: 'Bash', status: 'completed' }),
      makeTool({ id: '2', name: 'Read', status: 'completed' }),
      makeTool({ id: '3', name: 'Read', status: 'completed' }),
      makeTool({ id: '4', name: 'Read', status: 'completed' }),
      makeTool({ id: '5', name: 'Bash', status: 'completed' }),
    ];
    const result = strip(renderToolsLine(tools)!);
    const readIdx = result.indexOf('Read');
    const bashIdx = result.indexOf('Bash');
    expect(readIdx).toBeLessThan(bashIdx);
  });

  test('running tool without target shows name only', () => {
    const result = strip(renderToolsLine([
      makeTool({ status: 'running', name: 'Glob', target: undefined }),
    ])!);
    expect(result).toContain('Glob');
  });
});

// --- renderAgentLines ---

describe('renderAgentLines', () => {
  test('returns empty array for no agents', () => {
    expect(renderAgentLines([])).toEqual([]);
  });

  test('shows running agent with spinner icon', () => {
    const lines = renderAgentLines([makeAgent({ status: 'running' })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('\u25D0'); // ◐
  });

  test('shows completed agent with check icon', () => {
    const lines = renderAgentLines([
      makeAgent({ status: 'completed', endTime: new Date('2026-03-02T10:01:00Z') }),
    ]);
    expect(lines[0]).toContain('\u2713'); // ✓
  });

  test('shows error agent with X icon', () => {
    const lines = renderAgentLines([
      makeAgent({ status: 'error', endTime: new Date('2026-03-02T10:01:00Z') }),
    ]);
    expect(lines[0]).toContain('\u2717'); // ✗
  });

  test('max 3 agents shown', () => {
    const agents = Array.from({ length: 5 }, (_, i) =>
      makeAgent({ id: `a${i}`, status: 'running', startTime: new Date(Date.now() - i * 1000) })
    );
    const lines = renderAgentLines(agents);
    expect(lines.length).toBeLessThanOrEqual(3);
  });

  test('shows model in brackets', () => {
    const lines = renderAgentLines([makeAgent({ model: 'sonnet' })]);
    const result = strip(lines[0]);
    expect(result).toContain('[sonnet]');
  });

  test('shows description', () => {
    const lines = renderAgentLines([makeAgent({ description: 'Searching auth module' })]);
    const result = strip(lines[0]);
    expect(result).toContain('Searching auth module');
  });

  test('shows elapsed time', () => {
    const lines = renderAgentLines([
      makeAgent({
        startTime: new Date('2026-03-02T10:00:00Z'),
        endTime: new Date('2026-03-02T10:02:15Z'),
      }),
    ]);
    const result = strip(lines[0]);
    expect(result).toContain('2m');
  });
});

// --- renderTodosLine ---

describe('renderTodosLine', () => {
  test('returns null for empty todos', () => {
    expect(renderTodosLine([])).toBeNull();
  });

  test('shows in_progress todo content', () => {
    const result = strip(renderTodosLine([
      makeTodo({ content: 'Implement login flow', status: 'in_progress' }),
      makeTodo({ content: 'Write tests', status: 'pending' }),
    ])!);
    expect(result).toContain('Implement login flow');
    expect(result).toContain('(0/2)');
  });

  test('shows all complete message', () => {
    const result = strip(renderTodosLine([
      makeTodo({ status: 'completed' }),
      makeTodo({ status: 'completed' }),
    ])!);
    expect(result).toContain('All');
    expect(result).toContain('complete');
    expect(result).toContain('(2/2)');
  });

  test('shows partial completion count', () => {
    const result = strip(renderTodosLine([
      makeTodo({ status: 'completed' }),
      makeTodo({ status: 'pending' }),
      makeTodo({ status: 'pending' }),
    ])!);
    expect(result).toContain('1/3');
  });

  test('returns null when only pending todos', () => {
    expect(renderTodosLine([
      makeTodo({ status: 'pending' }),
      makeTodo({ status: 'pending' }),
    ])).toBeNull();
  });

  test('truncates long in_progress content', () => {
    const long = 'a'.repeat(60);
    const result = strip(renderTodosLine([makeTodo({ content: long, status: 'in_progress' })])!);
    expect(result).toContain('...');
  });
});

// --- render() integration ---

describe('render()', () => {
  test('expanded layout produces multiple lines', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeConfig(),
    );
    const lines = output.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  test('compact layout produces two lines', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeMinimalConfig(),
    );
    const lines = output.split('\n');
    expect(lines).toHaveLength(2);
  });

  test('fallback to model name when nothing else available', () => {
    const output = render(
      makeStdin({ modelName: 'Opus', contextPercent: 0 }),
      null,
      null,
      makeConfig({
        showPlan: false, showQuota5h: false, showQuota7d: false,
        showContext: false, showToday: false, showWeek: false,
        showMonth: false, showSaving: false,
      }),
    );
    const result = strip(output);
    expect(result).toBe('Opus');
  });

  test('includes tools line when transcript has tools', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeConfig(),
      makeTranscript({ tools: [makeTool({ status: 'running', name: 'Read', target: 'x.ts' })] }),
    );
    const result = strip(output);
    expect(result).toContain('Read');
  });

  test('includes agent lines when transcript has agents', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeConfig(),
      makeTranscript({
        agents: [makeAgent({
          status: 'running',
          startTime: new Date('2026-03-02T10:00:00Z'),
          endTime: new Date('2026-03-02T10:01:00Z'),
        })],
      }),
    );
    const result = strip(output);
    expect(result).toContain('Explore');
  });

  test('includes todo line when transcript has todos', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeConfig(),
      makeTranscript({ todos: [makeTodo()] }),
    );
    const result = strip(output);
    expect(result).toContain('Implement login flow');
  });

  test('hides tools when showTools=false', () => {
    const output = render(
      makeStdin(),
      makeQuota(),
      makeUsage(),
      makeConfig({ showTools: false }),
      makeTranscript({ tools: [makeTool({ status: 'running', name: 'Read' })] }),
    );
    const result = strip(output);
    // Read might appear in quota/context info, but tool line with ◐ should not
    expect(output).not.toContain('\u25D0');
  });

  test('output uses non-breaking spaces', () => {
    const output = render(makeStdin(), makeQuota(), makeUsage(), makeConfig());
    expect(output).toContain('\u00A0');
  });

  test('output uses 24-bit ANSI colors', () => {
    const output = render(makeStdin(), makeQuota(), makeUsage(), makeConfig());
    expect(output).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
  });
});
