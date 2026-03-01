# CLAUDE.md — Claude Office

## What is this?

Claude Office is a monitoring tool for Claude Code agents. It has two modes:

1. **Statusline plugin** — compact 2-line display embedded in Claude Code's status bar
2. **Standalone TUI dashboard** — full-screen terminal dashboard with live updates

## Project structure

```
src/
  statusline/           # Statusline plugin (stateless, single-shot, <300ms)
    index.ts            # Entry: stdin → collect → render → stdout
    stdin.ts            # Parse Claude Code's stdin JSON
    agent-scanner.ts    # Scan ~/.claude/projects/ for active agents (5s cache)
    usage-scanner.ts    # Aggregate token costs from JSONL files (30s cache)
    render.ts           # Compact 2-line ANSI renderer
  data/
    types.ts            # Shared types (AgentState, QuotaData, UsageSummary, etc.)
    quota-api.ts        # Anthropic OAuth usage API (rate limit quotas, 60s cache)
    collector.ts        # Full agent collector for standalone dashboard
  terminal/             # TUI dashboard renderer (ANSI, sixel, kitty)
  events/               # Event bus, file watchers, process tracker
  scene/                # Isometric office visualization
  sprites/              # Pixel art sprite data
  index.ts              # Standalone TUI entry point
.claude-plugin/
  plugin.json           # Claude Code plugin metadata
  marketplace.json      # Plugin marketplace listing
commands/
  setup.md              # /claude-office:setup skill
```

## Runtime

- **Bun only** — uses native Bun APIs (Bun.file, Bun.write, Bun.spawnSync, Bun.stdin)
- TypeScript runs directly, no build step
- `bun run typecheck` for type checking

## Key conventions

- All file I/O uses `Bun.file()` / `Bun.write()` — no Node.js `fs` open/read/close patterns
- File-based caches at `~/.claude/plugins/claude-office/` (quota 60s, agents 5s, usage 30s)
- Statusline must complete in **<300ms** — cache hit path is ~33ms
- ANSI colors use 24-bit RGB via `\x1b[38;2;r;g;bm` — no 256-color fallback
- Non-breaking space (`\u00A0`) in statusline output to prevent whitespace collapsing
- The standalone dashboard is event-driven (file watchers + process polling), the statusline is stateless

## Commands

- `bun run start` — launch standalone TUI dashboard
- `bun run src/statusline/index.ts` — run statusline (expects stdin JSON pipe)
- `bun run typecheck` — type-check statusline modules
