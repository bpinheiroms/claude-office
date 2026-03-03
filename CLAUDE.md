# CLAUDE.md — Claude Office

## What is this?

Claude Office is a statusline plugin for Claude Code that shows plan quota, real-time costs, monthly saving, tool activity, agent tracking, and todo progress. It runs as a stateless single-shot process invoked by Claude Code every ~300ms.

## Hard rules

These rules are non-negotiable. Follow them exactly.

### Bun only — zero Node.js APIs

- **All file I/O must use Bun APIs**: `Bun.file()`, `Bun.write()`, `Bun.stdin`, `Bun.file().stream()`, `Bun.file().slice()`
- **NEVER use Node.js**: no `fs`, no `readline`, no `stream`, no `http`, no `child_process`
- **Exception**: `path` and `os` from Node.js are fine (Bun provides compatible implementations)
- TypeScript runs directly via `bun run` — no build step, no bundler, no transpiler
- Use `bun run typecheck` (runs `tsc -p tsconfig.json`) to validate types

### Performance budget: 300ms max

- Claude Code kills the statusline process after 300ms — every code path must complete within this
- Cache hit path must be **<5ms** — this is the common case (~95% of invocations)
- Cache miss path must be **<200ms** — network + file I/O + parsing
- Never block on a single slow operation — use `Promise.all()` to parallelize independent work
- Never do synchronous file I/O in the hot path

### ANSI colors: 24-bit RGB only

- Use `\x1b[38;2;r;g;bm` format — no 16-color ANSI, no 256-color fallback
- All colors are defined in the `C` object in `render.ts` via the `c(r, g, b)` helper
- Always reset with `\x1b[0m` (the `RST` constant) after colored text

### Non-breaking spaces

- Use `\u00A0` (non-breaking space) between statusline elements to prevent terminal whitespace collapsing
- The `S` constant in `render.ts` is `\u00A0` — use it instead of regular spaces in output

## Project structure

```text
src/
  statusline/               # Statusline plugin (stateless, single-shot)
    index.ts                # Entry: stdin -> config -> [quota, usage, transcript] -> render -> stdout
    stdin.ts                # Parse Claude Code's stdin JSON (model, context window, transcript path)
    config.ts               # Config loader with presets (full/minimal), mtime-cached
    usage-scanner.ts        # Token cost aggregation from JSONL files (30s cache, per-file mtime tracking)
    render.ts               # Modular ANSI renderer with extracted tools/agents/todos functions
    transcript.ts           # Incremental transcript parser (10s cache, byte-offset tracking)
  data/
    types.ts                # QuotaData type definition
    quota-api.ts            # Anthropic OAuth usage API + automatic token refresh (60s cache)
.claude-plugin/
  plugin.json               # Claude Code plugin metadata (name, commands, version)
  marketplace.json          # Plugin marketplace listing
commands/
  setup.md                  # /claude-office:setup — configures statusline in settings.json
  configure.md              # /claude-office:configure — interactive display configuration
```

## Execution flow

```text
Claude Code pipes stdin JSON every ~300ms
  │
  ├─ Phase 1 (parallel): readStdin() + loadConfig()
  │
  ├─ Phase 2 (parallel): getQuota() + scanUsage() + parseTranscript()
  │
  ├─ Phase 3: render(stdin, quota, usage, config, transcript)
  │
  └─ stdout → exit
```

Each invocation is stateless — no sockets, no daemon, no in-memory state between calls. All persistence is through file-based caches.

## Caching strategy

Every data source has its own persistent file cache at `~/.claude/plugins/claude-office/`:

| File | TTL | What it caches |
|------|-----|----------------|
| `.quota-cache.json` | 60s | Anthropic API response (plan name, 5h/7d utilization) |
| `.usage-cache.json` | 30s | Per-file daily cost breakdown + aggregate totals |
| `.transcript-cache.json` | 10s | Full parsed state (tools, agents, todos) + file byte offset |
| `config.json` | mtime | User display preferences (checked via mtime, no TTL) |

### How each cache works

**Quota** (`quota-api.ts`): Simple TTL. If cache is fresh, return it. On miss, call Anthropic OAuth API, auto-refresh token if expired.

**Usage** (`usage-scanner.ts`): Per-file mtime tracking. Each JSONL file's `mtimeMs` is stored alongside its daily cost breakdown (`{ "2026-03-02": 51.20 }`). On cache miss, only re-parse files whose mtime changed. Time-window buckets (today/week/month) are recomputed from daily breakdowns without re-parsing.

**Transcript** (`transcript.ts`): Incremental byte-offset reading. Caches the full parsed state (tool map, agent map, todos, task ID index) alongside the file size. On next invocation: if file only grew → restore state from cache, read only new bytes from the cached offset. If file was truncated/replaced → full re-parse.

## Layout

### Expanded (preset: `full`)

```text
Line 1: Plan Max | Today $XX | Week $XXX | Month $XXX | Monthly Saving +$XX
Line 2: 5h ━━━━━━━━━━ XX%  7d ━━━━━━━━━━ XX%  Current Context ━━━━━━━━━━ XX%
Line 3: ◐ Read: .../file.ts | ✓ Edit ×10 | ✓ Bash ×3          (tools)
Line 4: ◐ Explore [sonnet]: Searching auth module (2m 15s)     (agents)
Line 5: ▸ Implement login flow (3/7)                           (todos)
```

Lines 3-5 only appear when there's activity and the corresponding config flag is on.

### Compact (preset: `minimal`)

```text
Plan Max | Today $51 | Monthly Saving +$16
5h ━━━━━━━━━━ 14%  Current Context ━━━━━━━━━━ 43%
```

Same two-line structure as expanded, with fewer elements enabled.

## Key patterns

### Adding a new data source

1. Create the data fetcher in `src/statusline/` or `src/data/`
2. Add a file-based cache with TTL (follow `quota-api.ts` or `usage-scanner.ts` pattern)
3. Call it in `index.ts` Phase 2 via `Promise.all()` — never sequentially
4. Add a render function in `render.ts` (isolated, returns `string | null`)
5. Add a `showXxx` boolean to `DisplayConfig` in `config.ts` and both presets

### Adding a new tool target in transcript

Add a case to `extractTarget()` in `transcript.ts`. Return the most useful single string for display (file path, pattern, URL, etc.). Truncation happens in the render layer.

### Render functions

Each activity type has its own render function:
- `renderToolsLine(tools)` → `string | null`
- `renderAgentLines(agents)` → `string[]` (one line per agent)
- `renderTodosLine(todos)` → `string | null`

These are called from the main `render()` function and pushed to `lines[]`. Return `null` to skip.

### Progress indicators

Use horizontal bar characters for progress bars: `━` (U+2501) with color for filled and dimmer color for empty. The `dotBar(pct, color, width)` function handles this. Width defaults to 10 characters.

### Color semantics

| Color constant | RGB | Usage |
|---------------|-----|-------|
| `C.active` | `74, 222, 128` (green) | Positive saving, completed items |
| `C.idle` | `250, 204, 21` (yellow) | Running/in-progress indicators |
| `C.costBig` | `240, 180, 80` (amber) | All cost values (today, week, month) |
| `C.sub` | `160, 140, 200` (purple) | Normal quota usage, agent type labels |
| `C.ctxWarn` | `250, 180, 50` (yellow) | Quota 75-90% |
| `C.ctxCrit` | `240, 80, 80` (red) | Quota >90%, LIMIT state |
| `C.dim` | `90, 85, 75` | Labels (Today, Week, 5h, etc.) |
| `C.dimmer` | `55, 52, 45` | Empty progress dots, separators |
| `C.tool` | `100, 180, 220` (cyan) | Tool names |

## What NOT to do

- **Don't use Node.js fs/readline/stream** — use Bun.file(), Bun.write(), Bun.file().stream()
- **Don't add 256-color or 16-color ANSI fallbacks** — 24-bit RGB only
- **Don't add a build step** — TypeScript runs directly via Bun
- **Don't add a long-running daemon or server** — the statusline is stateless single-shot
- **Don't use regular spaces in output** — use `\u00A0` (non-breaking space)
- **Don't parse the full transcript file every time** — use incremental byte-offset reading
- **Don't make sequential network/file calls** — parallelize with Promise.all()
- **Don't add thresholds that turn cost values red** — costs are always amber
- **Don't add more presets** — only `full` and `minimal` exist

## Testing

- **Framework**: `bun test` (built-in, zero dependencies)
- **Convention**: `_test` export blocks expose internal functions for unit testing
  ```ts
  /** @internal — exported for unit testing only */
  export const _test = { helperA, helperB };
  ```
- **Location**: Tests colocated in `__tests__/` directories next to source
- **Fixtures**: Shared factories in `__tests__/helpers/fixtures.ts` (e.g. `makeStdin()`, `makeQuota()`)
- **Strategy**: Test content, not exact ANSI codes — use `strip()` helper to remove escape sequences, then `toContain('42%')`
- **Mocking**: Use `spyOn` / `mock.module` for `Bun.file` and `Bun.write` in integration-level tests

## Commands

```bash
bun test                       # Run all unit tests
bun test --watch               # Watch mode during development
bun run typecheck              # Type-check all modules
echo '{}' | bun run src/statusline/index.ts   # Run statusline with empty stdin
```
