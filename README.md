# Claude Office

Monitor all your Claude Code agents, quotas, and costs — from the statusline or a full-screen dashboard.

![statusline](https://img.shields.io/badge/claude--code-statusline%20plugin-8B5CF6) ![license](https://img.shields.io/badge/license-MIT-green) ![bun](https://img.shields.io/badge/runtime-bun-F9A03C)

## What it does

**Statusline plugin** — compact 2-line display embedded in Claude Code:

```
Max  5h ██░░░░░░░░ 15%  7d ██░░░░░░░░ 21%  Today $340  Week $2.2k
⠿ my-project 63% working  ⠿ other-project 51% thinking  ✓ docs done
```

**Standalone dashboard** — full-screen TUI with live updates, isometric office visualization, and detailed agent status.

### Features

- **Quota tracking** — 5-hour and 7-day rate limit utilization from Anthropic's API
- **Cost estimation** — today/week spend based on Opus token pricing
- **Agent monitoring** — all active Claude Code sessions across projects
- **Context usage** — per-agent context window percentage (color-coded)
- **Status detection** — working, thinking, responding, needs response, done, idle
- **Sub-agent awareness** — detects team members and sub-agents

## Install

Requires [Bun](https://bun.sh) v1.0+.

```bash
git clone https://github.com/bpinheiroms/claude-office.git
cd claude-office
bun install
```

## Usage

### As a Claude Code statusline plugin

Run the setup command inside Claude Code:

```
/claude-office:setup
```

Or configure manually — add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "command": ["bun", "run", "/path/to/claude-office/src/statusline/index.ts"]
  }
}
```

### As a standalone dashboard

```bash
bun run start
```

Controls: `j`/`k` scroll, `q` quit.

### Debug mode

Dumps raw agent/usage/quota data as JSON:

```bash
bun run debug
```

## How it works

### Statusline (plugin mode)

Claude Code invokes the statusline process every ~300ms, piping a JSON object to stdin with model and context info. The process:

1. Reads stdin JSON
2. Checks file-based caches (agents, usage, quota)
3. If cache miss: scans `~/.claude/projects/` and Anthropic's API
4. Renders 2 compact lines to stdout
5. Exits

**Performance:** ~33ms on cache hit, ~200ms on cache miss. Well under the 300ms budget.

| Data | Cache TTL | Source |
|------|-----------|--------|
| Rate limit quota | 60s | Anthropic OAuth API |
| Agent status | 5s | `~/.claude/projects/` JSONL files |
| Token usage/costs | 30s | JSONL files (with per-file mtime tracking) |

### Dashboard (standalone mode)

Event-driven architecture with file watchers, process tracking, and render coalescing. Watches `~/.claude/projects/` for JSONL changes and refreshes in real-time.

## Project structure

```
src/
  statusline/           Statusline plugin (stateless, <300ms)
    index.ts            Entry point
    stdin.ts            Parse Claude Code stdin
    agent-scanner.ts    Agent discovery (5s cache)
    usage-scanner.ts    Cost aggregation (30s cache)
    render.ts           2-line ANSI renderer
  data/
    types.ts            Shared TypeScript types
    quota-api.ts        Anthropic rate limit API
    collector.ts        Full agent collector
  terminal/             Dashboard renderer
  events/               Event bus, watchers, process tracker
  index.ts              Standalone dashboard entry
.claude-plugin/         Plugin metadata
commands/
  setup.md              /claude-office:setup skill
```

## License

[MIT](LICENSE)
