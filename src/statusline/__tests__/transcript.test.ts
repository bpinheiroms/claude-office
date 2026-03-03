import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { _test, parseTranscript } from '../transcript.js';
import { makeToolUseLine, makeToolResultLine, makeJsonlLine } from './helpers/fixtures.js';

const {
  extractTarget, resolveTaskIndex, normalizeTaskStatus,
  processLine, buildResult, emptyState,
} = _test;

// --- extractTarget ---

describe('extractTarget', () => {
  test('Read → file_path', () => {
    expect(extractTarget('Read', { file_path: '/src/index.ts' })).toBe('/src/index.ts');
  });

  test('Write → file_path', () => {
    expect(extractTarget('Write', { file_path: '/src/out.ts' })).toBe('/src/out.ts');
  });

  test('Edit → file_path', () => {
    expect(extractTarget('Edit', { file_path: '/src/edit.ts' })).toBe('/src/edit.ts');
  });

  test('Read → path fallback', () => {
    expect(extractTarget('Read', { path: '/fallback.ts' })).toBe('/fallback.ts');
  });

  test('NotebookEdit → file_path', () => {
    expect(extractTarget('NotebookEdit', { file_path: '/nb.ipynb' })).toBe('/nb.ipynb');
  });

  test('Glob → pattern', () => {
    expect(extractTarget('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  test('Grep → pattern', () => {
    expect(extractTarget('Grep', { pattern: 'TODO' })).toBe('TODO');
  });

  test('Bash → truncated command', () => {
    const longCmd = 'a'.repeat(50);
    const result = extractTarget('Bash', { command: longCmd });
    expect(result!.length).toBe(33); // 30 + '...'
    expect(result).toEndWith('...');
  });

  test('Bash → short command unchanged', () => {
    expect(extractTarget('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  test('Bash → undefined when no command', () => {
    expect(extractTarget('Bash', {})).toBeUndefined();
  });

  test('WebFetch → url', () => {
    expect(extractTarget('WebFetch', { url: 'https://example.com' })).toBe('https://example.com');
  });

  test('WebSearch → query', () => {
    expect(extractTarget('WebSearch', { query: 'bun testing' })).toBe('bun testing');
  });

  test('unknown tool → undefined', () => {
    expect(extractTarget('CustomTool', { foo: 'bar' })).toBeUndefined();
  });

  test('no input → undefined', () => {
    expect(extractTarget('Read', undefined)).toBeUndefined();
  });
});

// --- normalizeTaskStatus ---

describe('normalizeTaskStatus', () => {
  test('pending → pending', () => {
    expect(normalizeTaskStatus('pending')).toBe('pending');
  });

  test('not_started → pending', () => {
    expect(normalizeTaskStatus('not_started')).toBe('pending');
  });

  test('in_progress → in_progress', () => {
    expect(normalizeTaskStatus('in_progress')).toBe('in_progress');
  });

  test('running → in_progress', () => {
    expect(normalizeTaskStatus('running')).toBe('in_progress');
  });

  test('completed → completed', () => {
    expect(normalizeTaskStatus('completed')).toBe('completed');
  });

  test('complete → completed', () => {
    expect(normalizeTaskStatus('complete')).toBe('completed');
  });

  test('done → completed', () => {
    expect(normalizeTaskStatus('done')).toBe('completed');
  });

  test('deleted → completed', () => {
    expect(normalizeTaskStatus('deleted')).toBe('completed');
  });

  test('unknown status → null', () => {
    expect(normalizeTaskStatus('banana')).toBeNull();
  });

  test('non-string → null', () => {
    expect(normalizeTaskStatus(42)).toBeNull();
    expect(normalizeTaskStatus(null)).toBeNull();
    expect(normalizeTaskStatus(undefined)).toBeNull();
  });
});

// --- resolveTaskIndex ---

describe('resolveTaskIndex', () => {
  test('resolves by taskIdToIndex map', () => {
    const map = new Map([['abc', 2]]);
    const todos = [{ content: 'a', status: 'pending' as const }, { content: 'b', status: 'pending' as const }, { content: 'c', status: 'pending' as const }];
    expect(resolveTaskIndex('abc', map, todos)).toBe(2);
  });

  test('resolves numeric string as 1-based index', () => {
    const map = new Map<string, number>();
    const todos = [{ content: 'a', status: 'pending' as const }, { content: 'b', status: 'pending' as const }];
    expect(resolveTaskIndex('2', map, todos)).toBe(1); // 2 - 1 = 1
  });

  test('returns null for out-of-range index', () => {
    const map = new Map<string, number>();
    const todos = [{ content: 'a', status: 'pending' as const }];
    expect(resolveTaskIndex('5', map, todos)).toBeNull();
  });

  test('returns null for non-string/number', () => {
    const map = new Map<string, number>();
    expect(resolveTaskIndex(null, map, [])).toBeNull();
  });

  test('prefers taskIdToIndex over numeric fallback', () => {
    const map = new Map([['1', 0]]);
    const todos = [{ content: 'first', status: 'pending' as const }, { content: 'second', status: 'pending' as const }];
    expect(resolveTaskIndex('1', map, todos)).toBe(0);
  });

  test('returns null when mapped index exceeds todos length', () => {
    const map = new Map([['x', 10]]);
    const todos = [{ content: 'a', status: 'pending' as const }];
    expect(resolveTaskIndex('x', map, todos)).toBeNull();
  });
});

// --- processLine ---

describe('processLine', () => {
  test('ignores empty/short lines', () => {
    const state = emptyState();
    processLine('', state);
    processLine('short', state);
    expect(state.toolMap.size).toBe(0);
  });

  test('ignores invalid JSON', () => {
    const state = emptyState();
    processLine('this is not json at all!!!!', state);
    expect(state.toolMap.size).toBe(0);
  });

  test('tool_use adds to toolMap', () => {
    const state = emptyState();
    processLine(makeToolUseLine('t1', 'Read', { file_path: '/x.ts' }), state);
    expect(state.toolMap.has('t1')).toBe(true);
    const tool = state.toolMap.get('t1')!;
    expect(tool.name).toBe('Read');
    expect(tool.target).toBe('/x.ts');
    expect(tool.status).toBe('running');
  });

  test('tool_result completes tool', () => {
    const state = emptyState();
    processLine(makeToolUseLine('t1', 'Read'), state);
    processLine(makeToolResultLine('t1'), state);
    expect(state.toolMap.get('t1')!.status).toBe('completed');
  });

  test('tool_result with error marks tool as error', () => {
    const state = emptyState();
    processLine(makeToolUseLine('t1', 'Bash'), state);
    processLine(makeToolResultLine('t1', true), state);
    expect(state.toolMap.get('t1')!.status).toBe('error');
  });

  test('Agent tool_use adds to agentMap', () => {
    const state = emptyState();
    const line = makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        content: [{
          type: 'tool_use', id: 'a1', name: 'Agent',
          input: { subagent_type: 'Explore', model: 'sonnet', description: 'Searching' },
        }],
      },
    });
    processLine(line, state);
    expect(state.agentMap.has('a1')).toBe(true);
    const agent = state.agentMap.get('a1')!;
    expect(agent.type).toBe('Explore');
    expect(agent.model).toBe('sonnet');
    expect(agent.description).toBe('Searching');
    expect(agent.status).toBe('running');
  });

  test('Agent tool_result completes agent', () => {
    const state = emptyState();
    processLine(makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'Explore' } }] },
    }), state);
    processLine(makeJsonlLine({
      timestamp: '2026-03-02T10:01:00Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'a1' }] },
    }), state);
    expect(state.agentMap.get('a1')!.status).toBe('completed');
  });

  test('TodoWrite replaces todos and rebuilds taskIdToIndex', () => {
    const state = emptyState();
    state.todos.push({ content: 'old', status: 'pending' });
    state.taskIdToIndex.set('old-id', 0);

    const line = makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        content: [{
          type: 'tool_use', id: 'tw1', name: 'TodoWrite',
          input: {
            todos: [
              { id: 'task-1', content: 'New task A', status: 'pending' },
              { id: 'task-2', content: 'New task B', status: 'in_progress' },
            ],
          },
        }],
      },
    });
    processLine(line, state);

    expect(state.todos).toHaveLength(2);
    expect(state.todos[0].content).toBe('New task A');
    expect(state.todos[1].content).toBe('New task B');
    expect(state.todos[1].status).toBe('in_progress');
    expect(state.taskIdToIndex.get('task-1')).toBe(0);
    expect(state.taskIdToIndex.get('task-2')).toBe(1);
    expect(state.taskIdToIndex.has('old-id')).toBe(false);
  });

  test('TaskCreate appends a todo', () => {
    const state = emptyState();
    const line = makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        content: [{
          type: 'tool_use', id: 'tc1', name: 'TaskCreate',
          input: { subject: 'Write tests', description: 'Add unit tests' },
        }],
      },
    });
    processLine(line, state);
    expect(state.todos).toHaveLength(1);
    expect(state.todos[0].content).toBe('Write tests');
    expect(state.todos[0].status).toBe('pending');
  });

  test('TaskUpdate updates existing todo status', () => {
    const state = emptyState();
    state.todos.push({ content: 'Fix bug', status: 'pending' });
    state.taskIdToIndex.set('1', 0);

    const line = makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        content: [{
          type: 'tool_use', id: 'tu1', name: 'TaskUpdate',
          input: { taskId: '1', status: 'in_progress' },
        }],
      },
    });
    processLine(line, state);
    expect(state.todos[0].status).toBe('in_progress');
  });

  test('TaskUpdate updates content via subject', () => {
    const state = emptyState();
    state.todos.push({ content: 'Old name', status: 'pending' });
    state.taskIdToIndex.set('1', 0);

    processLine(makeJsonlLine({
      timestamp: '2026-03-02T10:00:00Z',
      message: {
        content: [{
          type: 'tool_use', id: 'tu1', name: 'TaskUpdate',
          input: { taskId: '1', subject: 'New name' },
        }],
      },
    }), state);
    expect(state.todos[0].content).toBe('New name');
  });

  test('sets sessionStart from first timestamp', () => {
    const state = emptyState();
    processLine(makeToolUseLine('t1', 'Read'), state);
    expect(state.sessionStart).toBeInstanceOf(Date);
  });
});

// --- buildResult ---

describe('buildResult', () => {
  test('returns empty TranscriptData for empty state', () => {
    const result = buildResult(emptyState());
    expect(result.tools).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(result.todos).toEqual([]);
  });

  test('limits tools to last 20', () => {
    const state = emptyState();
    for (let i = 0; i < 25; i++) {
      state.toolMap.set(`t${i}`, {
        id: `t${i}`, name: 'Read', status: 'completed',
        startTime: new Date(), endTime: new Date(),
      });
    }
    const result = buildResult(state);
    expect(result.tools).toHaveLength(20);
  });

  test('limits agents to last 10', () => {
    const state = emptyState();
    for (let i = 0; i < 15; i++) {
      state.agentMap.set(`a${i}`, {
        id: `a${i}`, type: 'Explore', status: 'completed',
        startTime: new Date(), endTime: new Date(),
      });
    }
    const result = buildResult(state);
    expect(result.agents).toHaveLength(10);
  });

  test('includes sessionStart', () => {
    const state = emptyState();
    state.sessionStart = new Date('2026-03-02T10:00:00Z');
    const result = buildResult(state);
    expect(result.sessionStart).toEqual(new Date('2026-03-02T10:00:00Z'));
  });
});

// --- parseTranscript ---

describe('parseTranscript', () => {
  test('empty path returns EMPTY', async () => {
    const result = await parseTranscript('');
    expect(result.tools).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(result.todos).toEqual([]);
  });

  test('non-existent file returns EMPTY', async () => {
    const result = await parseTranscript('/tmp/nonexistent-' + Date.now() + '.jsonl');
    expect(result.tools).toEqual([]);
  });

  test('parses JSONL from real temp file', async () => {
    const tmpPath = `/tmp/test-transcript-${Date.now()}.jsonl`;
    const lines = [
      makeToolUseLine('t1', 'Read', { file_path: '/src/main.ts' }),
      makeToolResultLine('t1'),
      makeToolUseLine('t2', 'Edit', { file_path: '/src/main.ts' }),
    ].join('\n') + '\n';

    await Bun.write(tmpPath, lines);
    try {
      const result = await parseTranscript(tmpPath);
      expect(result.tools.length).toBeGreaterThanOrEqual(2);
      const read = result.tools.find(t => t.name === 'Read');
      expect(read).toBeDefined();
      expect(read!.status).toBe('completed');
      const edit = result.tools.find(t => t.name === 'Edit');
      expect(edit).toBeDefined();
      expect(edit!.status).toBe('running');
    } finally {
      try { await Bun.write(tmpPath, ''); } catch {}
    }
  });
});
