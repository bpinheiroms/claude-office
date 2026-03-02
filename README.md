# Claude Office

Claude Code statusline plugin — track your plan quota, costs, and usage at a glance.

![statusline](https://img.shields.io/badge/claude--code-statusline%20plugin-8B5CF6) ![license](https://img.shields.io/badge/license-MIT-green) ![bun](https://img.shields.io/badge/runtime-bun-F9A03C)

## What it does

Single-line statusline embedded in Claude Code:

```
Max  5h ██░░░░░░░░ 15%  7d ██░░░░░░░░ 21%  Today $340  Week $2.2k  Month $4.8k
```

### Features

- **Plan name** — shows Max, Pro, or Team
- **Quota tracking** — 5-hour and 7-day rate limit utilization bars (color-coded)
- **Cost estimation** — today, week, and month spend based on Opus token pricing
- **Auto token refresh** — refreshes expired OAuth tokens automatically

## Install

Requires [Bun](https://bun.sh) v1.0+.

```bash
git clone https://github.com/bpinheiroms/claude-office.git
cd claude-office
bun install
```

## Usage

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

## How it works

Claude Code invokes the statusline process every ~300ms, piping a JSON object to stdin. The process:

1. Reads stdin JSON (model + context info)
2. Checks file-based caches (quota, usage)
3. If cache miss: fetches Anthropic's API and scans `~/.claude/projects/`
4. Renders a single line to stdout
5. Exits

**Performance:** ~5ms on cache hit, ~200ms on cache miss. Well under the 300ms budget.

| Data | Cache TTL | Source |
|------|-----------|--------|
| Rate limit quota | 60s | Anthropic OAuth API |
| Token usage/costs | 30s | `~/.claude/projects/` JSONL files |

### Token refresh

When the OAuth access token expires, the plugin automatically refreshes it using the stored refresh token and updates the macOS Keychain. No manual intervention needed.

## Project structure

```
src/
  statusline/           Statusline plugin (stateless, <300ms)
    index.ts            Entry: stdin -> collect -> render -> stdout
    stdin.ts            Parse Claude Code stdin JSON
    usage-scanner.ts    Cost aggregation (30s cache, per-file mtime tracking)
    render.ts           Single-line ANSI renderer
  data/
    types.ts            Shared types (QuotaData)
    quota-api.ts        Anthropic OAuth API + token refresh
.claude-plugin/         Plugin metadata
commands/
  setup.md              /claude-office:setup skill
```

## License

[MIT](LICENSE)
