# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-03-01

### Added
- Statusline plugin for Claude Code — compact 2-line display
  - Quota tracking (5h/7d rate limit utilization from Anthropic API)
  - Cost estimation (today/week based on Opus token pricing)
  - Agent monitoring (all active sessions across projects)
  - Context usage per agent (color-coded percentage)
  - Status detection (working, thinking, responding, needs response, done, idle)
- Standalone TUI dashboard with live updates
  - Full-screen terminal rendering with ANSI colors
  - Event-driven architecture (file watchers + process polling)
  - Isometric office visualization
  - Keyboard navigation (j/k scroll, q quit)
- `/claude-office:setup` skill for one-command configuration
- File-based caching (agents 5s, usage 30s, quota 60s)
- Per-file mtime tracking for efficient usage scanning
- Sub-agent and team awareness
