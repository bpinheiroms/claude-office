# CLAUDE.md — Claude Office

## What is this?

Claude Office is a statusline plugin for Claude Code that shows plan quota, costs, and usage.

## Project structure

```
src/
  statusline/           # Statusline plugin (stateless, single-shot, <300ms)
    index.ts            # Entry: stdin -> collect -> render -> stdout
    stdin.ts            # Parse Claude Code's stdin JSON
    config.ts           # Config loader with presets (full/minimal)
    usage-scanner.ts    # Aggregate token costs from JSONL files (30s cache, mtime tracking)
    render.ts           # Modular ANSI renderer (expanded/compact layout)
    transcript.ts       # Incremental transcript parser (10s cache, byte-offset tracking)
  data/
    types.ts            # QuotaData type
    quota-api.ts        # Anthropic OAuth usage API + token refresh (60s cache)
.claude-plugin/
  plugin.json           # Claude Code plugin metadata
  marketplace.json      # Plugin marketplace listing
commands/
  setup.md              # /claude-office:setup skill
  configure.md          # /claude-office:configure skill
```

## Runtime

- **Bun only** — uses native Bun APIs (Bun.file, Bun.write, Bun.stdin, Bun.file().stream())
- TypeScript runs directly, no build step
- `bun run typecheck` for type checking

## Key conventions

- All file I/O uses `Bun.file()` / `Bun.write()` — no Node.js `fs` or `readline`
- File-based caches at `~/.claude/plugins/claude-office/` (quota 60s, usage 30s, transcript 10s)
- Transcript uses incremental parsing: caches file size + parsed state, reads only new bytes
- Statusline must complete in **<300ms** — cache hit path is ~5ms
- ANSI colors use 24-bit RGB via `\x1b[38;2;r;g;bm` — no 256-color fallback
- Non-breaking space (`\u00A0`) in statusline output to prevent whitespace collapsing
- OAuth token refresh via `console.anthropic.com/v1/oauth/token` when token expires
- Expanded layout: Line 1 = Plan + Costs, Line 2 = Quota bars + Context
- Only two presets: `full` (expanded, everything) and `minimal` (compact, essentials)

## Commands

- `bun run src/statusline/index.ts` — run statusline (expects stdin JSON pipe)
- `bun run typecheck` — type-check all modules
