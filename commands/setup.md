---
name: setup
description: Configure Claude Office as your Claude Code statusline
---

You are setting up the Claude Office statusline plugin. Follow these steps precisely:

## Step 1: Verify Bun is installed

Run `bun --version` to confirm Bun is available. This plugin requires Bun.

## Step 2: Find the plugin directory

The plugin directory is the directory containing this `commands/setup.md` file — one level up from `commands/`.
Verify by checking that `package.json` exists in that directory.
Store this absolute path as `PLUGIN_DIR`.

## Step 3: Test the statusline

Run a quick test to verify it works:
```bash
echo '{}' | bun run PLUGIN_DIR/src/statusline/index.ts
```
It should produce output (possibly just a newline if no data is available). It must not error.

## Step 4: Check for existing statusline

Read `~/.claude/settings.json` and check if `statusLine.command` is already configured.

- If another statusline is found, inform the user:
  > "You currently have `<existing command>` configured as your statusline. Shall I replace it with Claude Office?"
  Wait for confirmation before proceeding. If the user declines, stop here.
- If no statusline is configured, proceed directly.

## Step 5: Apply configuration

Update `~/.claude/settings.json` to set the statusline command. Read the file first, merge the new config, and write it back to preserve all existing settings:

```json
{
  "statusLine": {
    "type": "command",
    "command": "bun run PLUGIN_DIR/src/statusline/index.ts"
  }
}
```

Replace `PLUGIN_DIR` with the actual absolute path found in Step 2.

## Step 6: Confirm

Tell the user:
> Claude Office statusline is now configured! It will appear at the bottom of your Claude Code sessions.
> You can switch back at any time by editing `~/.claude/settings.json`.
>
> The statusline shows:
> - **Plan**: Max, Pro, or Team
> - **Quota**: 5-hour and 7-day rate limit utilization bars
> - **Costs**: Today, week, and month estimated spend
