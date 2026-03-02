import { describe, test, expect } from 'bun:test';
import { _test } from '../quota-api.js';

const { getPlanName, parseUtilization, parseDate } = _test;

// --- getPlanName ---

describe('getPlanName', () => {
  test('max → Max', () => {
    expect(getPlanName('max')).toBe('Max');
  });

  test('Max_subscription → Max', () => {
    expect(getPlanName('Max_subscription')).toBe('Max');
  });

  test('pro → Pro', () => {
    expect(getPlanName('pro')).toBe('Pro');
  });

  test('Pro_plan → Pro', () => {
    expect(getPlanName('Pro_plan')).toBe('Pro');
  });

  test('team → Team', () => {
    expect(getPlanName('team')).toBe('Team');
  });

  test('Team_enterprise → Team', () => {
    expect(getPlanName('Team_enterprise')).toBe('Team');
  });

  test('api → null', () => {
    expect(getPlanName('api')).toBeNull();
  });

  test('api_key → null', () => {
    expect(getPlanName('api_key')).toBeNull();
  });

  test('null → null', () => {
    expect(getPlanName(null)).toBeNull();
  });

  test('undefined → null', () => {
    expect(getPlanName(undefined)).toBeNull();
  });

  test('empty string → null', () => {
    expect(getPlanName('')).toBeNull();
  });

  test('unknown type → capitalized', () => {
    expect(getPlanName('enterprise')).toBe('Enterprise');
  });

  test('single char type → capitalized', () => {
    expect(getPlanName('x')).toBe('X');
  });
});

// --- parseUtilization ---

describe('parseUtilization', () => {
  test('rounds to nearest integer', () => {
    expect(parseUtilization(42.6)).toBe(43);
    expect(parseUtilization(42.4)).toBe(42);
  });

  test('clamps to 0', () => {
    expect(parseUtilization(-5)).toBe(0);
  });

  test('clamps to 100', () => {
    expect(parseUtilization(150)).toBe(100);
  });

  test('0 returns 0', () => {
    expect(parseUtilization(0)).toBe(0);
  });

  test('100 returns 100', () => {
    expect(parseUtilization(100)).toBe(100);
  });

  test('null returns null', () => {
    expect(parseUtilization(undefined)).toBeNull();
  });

  test('NaN returns null', () => {
    expect(parseUtilization(NaN)).toBeNull();
  });

  test('Infinity returns null', () => {
    expect(parseUtilization(Infinity)).toBeNull();
    expect(parseUtilization(-Infinity)).toBeNull();
  });
});

// --- parseDate ---

describe('parseDate', () => {
  test('valid ISO string → Date', () => {
    const result = parseDate('2026-03-02T18:00:00Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2026-03-02T18:00:00.000Z');
  });

  test('another valid date → Date', () => {
    const result = parseDate('2025-12-25T00:00:00Z');
    expect(result).toBeInstanceOf(Date);
  });

  test('invalid string → null', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });

  test('undefined → null', () => {
    expect(parseDate(undefined)).toBeNull();
  });

  test('empty string → null', () => {
    expect(parseDate('')).toBeNull();
  });
});
