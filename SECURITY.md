# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via email to **contato@bridglabs.com**.

Do not open a public GitHub issue for security vulnerabilities.

## Scope

Claude Office reads data from:
- `~/.claude/projects/` — JSONL session files (read-only)
- `~/.claude/settings.json` — Claude Code settings (read-only)
- `~/.claude/.credentials.json` — OAuth token for quota API (read-only)
- macOS Keychain — OAuth token fallback (read-only)
- Anthropic API (`api.anthropic.com/api/oauth/usage`) — rate limit data

It writes only to its own cache directory: `~/.claude/plugins/claude-office/`.
