# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.1] - 2026-03-03

### Fixed
- static badges for private repo + prevent release double-bump

### Documentation
- restore shields.io badges for license and stars
- install via plugin marketplace, move clone to Development

## [1.1.1] - 2026-03-02

### Fixed
- correct GitHub username references from brunosilvadev to bpinheiroms

## [1.1.0] - 2026-03-02

### Added
- **release**: auto-generate CHANGELOG from conventional commits

### Fixed
- **release**: use RELEASE_TOKEN to push directly to main
- **release**: add --no-tag flag for PR branch, prevent tag conflict
- **release**: use explicit bump in PR step, add GH_TOKEN
- **release**: tag merge commit directly, open PR for version bump
- **release**: always show script output before failing, push v1.0.0 tag
- **release**: restrict patch bumps to fix/perf/refactor/ci/chore only
- **release**: read full commit body for BREAKING CHANGE footer detection
- **release**: remove || true, validate tag points to HEAD
- **ci**: validate statusline output, add performance and graceful degradation tests

### Changed
- remove claude code action workflow
- fully automated release on merge to main

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
