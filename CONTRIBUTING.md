# Contributing to Claude Office

Thanks for your interest in contributing!

## Getting started

```bash
git clone https://github.com/bpinheiroms/claude-office.git
cd claude-office
bun install
```

## Development

```bash
# Type-check
bun run typecheck

# Test statusline (empty stdin)
echo '{}' | bun run src/statusline/index.ts

# Test with simulated context data
echo '{"context_window":{"used_percentage":45,"context_window_size":200000}}' | bun run src/statusline/index.ts

# Benchmark (must be <300ms)
time (echo '{}' | bun run src/statusline/index.ts > /dev/null)
```

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes in `src/`
3. Verify: `bun run typecheck` passes
4. Verify: `echo '{}' | bun run src/statusline/index.ts` produces output
5. Open a pull request

## Statusline performance

The statusline must complete in **<300ms**. If your changes affect `src/statusline/`, benchmark:

```bash
time (echo '{}' | bun run src/statusline/index.ts > /dev/null)
```

Cache hit should be ~33ms, cache miss ~200ms.

## Version bumps

Version must be synchronized across **3 files**:
- `package.json` → `"version"`
- `.claude-plugin/plugin.json` → `"version"`
- `.claude-plugin/marketplace.json` → `metadata.version`

Use `bun run release:bump <major|minor|patch>` to bump all three automatically.

## Code style

- TypeScript strict mode
- Bun native APIs (`Bun.file`, `Bun.write`, `Bun.spawnSync`)
- ANSI colors: 24-bit RGB (`\x1b[38;2;r;g;bm`)
- Non-breaking space (`\u00A0`) in statusline output
