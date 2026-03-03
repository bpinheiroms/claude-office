import { describe, test, expect } from 'bun:test';
import { _test } from '../usage-scanner.js';
import { makeUsageMessage } from './helpers/fixtures.js';

const { getPricing, getBillingCycleStart, toDateKey, parseMessageCost } = _test;

// --- getPricing ---

describe('getPricing', () => {
  test('opus-4.6 exact match', () => {
    const p = getPricing('claude-opus-4-6');
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  test('opus-4.5 pricing', () => {
    const p = getPricing('claude-opus-4-5-20251001');
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  test('opus-4.1 pricing', () => {
    const p = getPricing('claude-opus-4-1');
    expect(p.input).toBe(15);
    expect(p.output).toBe(75);
  });

  test('sonnet-4.6 pricing', () => {
    const p = getPricing('claude-sonnet-4-6');
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  test('sonnet-4.5 pricing', () => {
    const p = getPricing('claude-sonnet-4-5');
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  test('sonnet-4 pricing (major only fallback)', () => {
    const p = getPricing('claude-sonnet-4');
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
  });

  test('haiku-4.5 pricing', () => {
    const p = getPricing('claude-haiku-4-5');
    expect(p.input).toBe(1);
    expect(p.output).toBe(5);
  });

  test('haiku-3.5 pricing', () => {
    const p = getPricing('claude-haiku-3-5');
    expect(p.input).toBe(0.80);
    expect(p.output).toBe(4);
  });

  test('unknown model → default (opus-4.6) pricing', () => {
    const p = getPricing('unknown-model-9-9');
    expect(p.input).toBe(5);
    expect(p.output).toBe(25);
  });

  test('case insensitive', () => {
    const p = getPricing('CLAUDE-OPUS-4-6');
    expect(p.input).toBe(5);
  });

  test('cache write/read pricing for opus-4.6', () => {
    const p = getPricing('claude-opus-4-6');
    expect(p.cacheWrite).toBe(6.25);
    expect(p.cacheRead).toBe(0.50);
  });

  test('cache write/read pricing for haiku-3.5', () => {
    const p = getPricing('claude-haiku-3-5');
    expect(p.cacheWrite).toBe(1.00);
    expect(p.cacheRead).toBe(0.08);
  });
});

// --- getBillingCycleStart ---

describe('getBillingCycleStart', () => {
  test('Friday before 14:00 → previous Friday', () => {
    // Friday March 6 2026 at 10:00
    const now = new Date(2026, 2, 6, 10, 0, 0);
    const start = getBillingCycleStart(now);
    // Should go back to previous Friday (Feb 27)
    expect(start.getDay()).toBe(5); // Friday
    expect(start.getHours()).toBe(14);
    expect(start.getDate()).toBe(27);
    expect(start.getMonth()).toBe(1); // February
  });

  test('Friday after 14:00 → same Friday', () => {
    // Friday March 6 2026 at 16:00
    const now = new Date(2026, 2, 6, 16, 0, 0);
    const start = getBillingCycleStart(now);
    expect(start.getDay()).toBe(5);
    expect(start.getDate()).toBe(6);
    expect(start.getHours()).toBe(14);
  });

  test('Saturday → most recent Friday', () => {
    // Saturday March 7 2026
    const now = new Date(2026, 2, 7, 12, 0, 0);
    const start = getBillingCycleStart(now);
    expect(start.getDay()).toBe(5);
    expect(start.getDate()).toBe(6);
    expect(start.getHours()).toBe(14);
  });

  test('Wednesday → most recent Friday', () => {
    // Wednesday March 4 2026
    const now = new Date(2026, 2, 4, 12, 0, 0);
    const start = getBillingCycleStart(now);
    expect(start.getDay()).toBe(5);
    expect(start.getDate()).toBe(27);
    expect(start.getMonth()).toBe(1);
  });

  test('Monday → most recent Friday', () => {
    // Monday March 2 2026
    const now = new Date(2026, 2, 2, 12, 0, 0);
    const start = getBillingCycleStart(now);
    expect(start.getDay()).toBe(5);
    expect(start.getHours()).toBe(14);
  });

  test('Friday exactly at 14:00 → same Friday', () => {
    const now = new Date(2026, 2, 6, 14, 0, 0);
    const start = getBillingCycleStart(now);
    expect(start.getDate()).toBe(6);
  });
});

// --- toDateKey ---

describe('toDateKey', () => {
  test('formats with zero-padded month and day', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('formats double-digit month/day', () => {
    expect(toDateKey(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  test('formats March 2 2026', () => {
    expect(toDateKey(new Date(2026, 2, 2))).toBe('2026-03-02');
  });
});

// --- parseMessageCost ---

describe('parseMessageCost', () => {
  test('calculates cost with input + output tokens', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    expect(result).not.toBeNull();
    // 1M input * $5/1M + 100K output * $25/1M = $5 + $2.50 = $7.50
    expect(result!.costUSD).toBeCloseTo(7.5, 2);
    expect(result!.dateKey).toBe('2026-03-02');
  });

  test('calculates cost with all token types', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: {
          input_tokens: 100_000,
          output_tokens: 50_000,
          cache_creation_input_tokens: 200_000,
          cache_read_input_tokens: 500_000,
        },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    expect(result).not.toBeNull();
    // 100K * $5/1M + 50K * $25/1M + 200K * $6.25/1M + 500K * $0.50/1M
    // = $0.50 + $1.25 + $1.25 + $0.25 = $3.25
    expect(result!.costUSD).toBeCloseTo(3.25, 2);
  });

  test('uses message timestamp for dateKey', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-01T23:59:59Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    expect(result!.dateKey).toBe('2026-03-01');
  });

  test('falls back to fallbackDateKey for invalid timestamp', () => {
    const line = JSON.stringify({
      timestamp: 'not-a-date',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    expect(result!.dateKey).toBe('2026-03-02');
  });

  test('falls back to fallbackDateKey when no timestamp', () => {
    const line = JSON.stringify({
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    expect(result!.dateKey).toBe('2026-03-02');
  });

  test('returns null for zero cost', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
    expect(parseMessageCost(line, '2026-03-02')).toBeNull();
  });

  test('returns null for no usage', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-02T10:00:00Z',
      message: { model: 'claude-opus-4-6' },
    });
    expect(parseMessageCost(line, '2026-03-02')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(parseMessageCost('not json', '2026-03-02')).toBeNull();
  });

  test('returns null for no message', () => {
    const line = JSON.stringify({ timestamp: '2026-03-02T10:00:00Z' });
    expect(parseMessageCost(line, '2026-03-02')).toBeNull();
  });

  test('uses correct model pricing', () => {
    const line = JSON.stringify({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        model: 'claude-haiku-3-5',
        usage: { input_tokens: 1_000_000, output_tokens: 100_000 },
      },
    });
    const result = parseMessageCost(line, '2026-03-02');
    // 1M * $0.80/1M + 100K * $4/1M = $0.80 + $0.40 = $1.20
    expect(result!.costUSD).toBeCloseTo(1.20, 2);
  });

  test('handles numeric timestamp', () => {
    const ts = new Date('2026-03-02T10:00:00Z').getTime();
    const line = JSON.stringify({
      timestamp: ts,
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 1000, output_tokens: 500 },
      },
    });
    const result = parseMessageCost(line, '2026-01-01');
    expect(result!.dateKey).toBe('2026-03-02');
  });
});
