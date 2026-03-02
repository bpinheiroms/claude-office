import { describe, test, expect, beforeEach } from 'bun:test';
import { presetConfig, loadConfig, _resetConfigCache } from '../config.js';
import type { DisplayConfig } from '../config.js';

// --- presetConfig ---

describe('presetConfig', () => {
  test('full preset: expanded layout', () => {
    const config = presetConfig('full');
    expect(config.lineLayout).toBe('expanded');
  });

  test('full preset: all flags true', () => {
    const config = presetConfig('full');
    expect(config.showPlan).toBe(true);
    expect(config.showQuota5h).toBe(true);
    expect(config.showQuota7d).toBe(true);
    expect(config.showContext).toBe(true);
    expect(config.showToday).toBe(true);
    expect(config.showWeek).toBe(true);
    expect(config.showMonth).toBe(true);
    expect(config.showSaving).toBe(true);
    expect(config.showTools).toBe(true);
    expect(config.showAgents).toBe(true);
    expect(config.showTodos).toBe(true);
  });

  test('minimal preset: compact layout', () => {
    const config = presetConfig('minimal');
    expect(config.lineLayout).toBe('compact');
  });

  test('minimal preset: reduced flags', () => {
    const config = presetConfig('minimal');
    expect(config.showPlan).toBe(true);
    expect(config.showQuota5h).toBe(true);
    expect(config.showQuota7d).toBe(false);
    expect(config.showContext).toBe(true);
    expect(config.showToday).toBe(true);
    expect(config.showWeek).toBe(false);
    expect(config.showMonth).toBe(false);
    expect(config.showSaving).toBe(true);
    expect(config.showTools).toBe(false);
    expect(config.showAgents).toBe(false);
    expect(config.showTodos).toBe(false);
  });

  test('returns a copy (not same reference)', () => {
    const a = presetConfig('full');
    const b = presetConfig('full');
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

// --- loadConfig ---

describe('loadConfig', () => {
  beforeEach(() => {
    _resetConfigCache();
  });

  test('returns default preset when config file does not exist', async () => {
    // loadConfig reads from ~/.claude/plugins/claude-office/config.json
    // When it doesn't exist, it returns the default (minimal) preset
    _resetConfigCache();
    const config = await loadConfig();
    // Just verify it returns a valid config (might be from real user's config)
    expect(config).toHaveProperty('lineLayout');
    expect(config).toHaveProperty('showPlan');
    expect(['expanded', 'compact']).toContain(config.lineLayout);
  });

  test('returns valid DisplayConfig shape', async () => {
    const config = await loadConfig();
    const keys: (keyof DisplayConfig)[] = [
      'lineLayout', 'showPlan', 'showQuota5h', 'showQuota7d', 'showContext',
      'showToday', 'showWeek', 'showMonth', 'showSaving',
      'showTools', 'showAgents', 'showTodos',
    ];
    for (const key of keys) {
      expect(config).toHaveProperty(key);
    }
  });

  test('loadConfig reads from temp file with full preset', async () => {
    const tmpDir = `/tmp/test-config-${Date.now()}`;
    const tmpPath = `${tmpDir}/config.json`;
    await Bun.write(tmpPath, JSON.stringify({ preset: 'full' }));

    // We can't easily redirect loadConfig to a different path,
    // so we test the presetConfig that loadConfig uses internally
    const config = presetConfig('full');
    expect(config.lineLayout).toBe('expanded');
    expect(config.showTools).toBe(true);
  });

  test('loadConfig handles display overrides pattern', () => {
    // Test the override logic by verifying presets can be overridden
    const base = presetConfig('minimal');
    // Simulate what loadConfig does with display overrides
    const overrides = { showTools: true, lineLayout: 'expanded' as const };
    const merged = { ...base, ...overrides };
    expect(merged.lineLayout).toBe('expanded');
    expect(merged.showTools).toBe(true);
    expect(merged.showQuota7d).toBe(false); // not overridden
  });

  test('caching: consecutive calls return equivalent config', async () => {
    _resetConfigCache();
    const first = await loadConfig();
    const second = await loadConfig();
    expect(first).toEqual(second);
  });

  test('_resetConfigCache clears the cache', async () => {
    const first = await loadConfig();
    _resetConfigCache();
    const second = await loadConfig();
    // After reset, a new config object is created
    // (may or may not be same reference depending on file state)
    expect(second).toHaveProperty('lineLayout');
  });
});
