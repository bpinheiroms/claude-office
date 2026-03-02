import { describe, test, expect } from 'bun:test';
import { parseStdin } from '../stdin.js';

describe('parseStdin', () => {
  test('empty string → defaults', () => {
    const result = parseStdin('');
    expect(result.modelName).toBe('');
    expect(result.contextPercent).toBe(0);
    expect(result.contextTokens).toBe(0);
    expect(result.contextWindowSize).toBe(200_000);
    expect(result.cwd).toBe('');
    expect(result.transcriptPath).toBe('');
  });

  test('whitespace-only → defaults', () => {
    const result = parseStdin('   \n  ');
    expect(result.modelName).toBe('');
  });

  test('invalid JSON → defaults (no throw)', () => {
    const result = parseStdin('not json at all');
    expect(result.modelName).toBe('');
    expect(result.contextPercent).toBe(0);
  });

  test('uses used_percentage from Claude Code', () => {
    const result = parseStdin(JSON.stringify({
      model: { display_name: 'Opus' },
      context_window: {
        used_percentage: 42,
        context_window_size: 200_000,
      },
    }));
    expect(result.contextPercent).toBe(42);
    expect(result.modelName).toBe('Opus');
  });

  test('fallback: computes from current_usage tokens', () => {
    const result = parseStdin(JSON.stringify({
      context_window: {
        context_window_size: 200_000,
        current_usage: {
          input_tokens: 50_000,
          cache_read_input_tokens: 30_000,
          cache_creation_input_tokens: 20_000,
        },
      },
    }));
    // (50000 + 30000 + 20000) / 200000 * 100 = 50%
    expect(result.contextPercent).toBe(50);
  });

  test('contextPercent capped at 100', () => {
    const result = parseStdin(JSON.stringify({
      context_window: {
        context_window_size: 100_000,
        current_usage: {
          input_tokens: 150_000,
        },
      },
    }));
    expect(result.contextPercent).toBe(100);
  });

  test('parses transcript_path', () => {
    const result = parseStdin(JSON.stringify({
      transcript_path: '/tmp/transcript.jsonl',
    }));
    expect(result.transcriptPath).toBe('/tmp/transcript.jsonl');
  });

  test('parses cwd', () => {
    const result = parseStdin(JSON.stringify({
      cwd: '/home/user/project',
    }));
    expect(result.cwd).toBe('/home/user/project');
  });

  test('defaults context_window_size to 200000', () => {
    const result = parseStdin(JSON.stringify({}));
    expect(result.contextWindowSize).toBe(200_000);
  });

  test('parses total_input_tokens as contextTokens', () => {
    const result = parseStdin(JSON.stringify({
      context_window: { total_input_tokens: 84_000 },
    }));
    expect(result.contextTokens).toBe(84_000);
  });

  test('empty object → valid defaults', () => {
    const result = parseStdin('{}');
    expect(result.modelName).toBe('');
    expect(result.contextPercent).toBe(0);
  });
});
