---
name: configure
description: Configure Claude Office display options (layout, presets, display elements)
---

You are configuring the Claude Office statusline display. The config file lives at `~/.claude/plugins/claude-office/config.json`.

## Step 1: Detect existing config

Read `~/.claude/plugins/claude-office/config.json`. If it does not exist or is empty JSON, this is a **new user** — follow Flow A. If it has content, this is a **returning user** — follow Flow B.

---

## Flow A: New User (no config file)

### A1. Choose layout

Ask the user:

> **How should the statusline be laid out?**
>
> 1. **Expanded** (recommended) — costs on line 1, quota bars on line 2
> 2. **Compact** — everything on a single line

### A2. Choose preset

Ask the user:

> **Pick a preset to start from:**
>
> 1. **Full** — all features enabled (quota bars, current context, all costs, saving, tools, agents, todos)
> 2. **Minimal** — just the basics (5h quota, current context, today cost, saving)

### A3. Turn off elements

Show the user which elements are ON based on their chosen preset, then ask:

> **Want to turn anything OFF?** Select any you'd like to hide:
>
> - 5h quota bar (`showQuota5h`)
> - 7d quota bar (`showQuota7d`)
> - Current Context bar (`showContext`)
> - Today cost (`showToday`)
> - Week cost (`showWeek`)
> - Month cost (`showMonth`)
> - Monthly Saving indicator (`showSaving`)
> - Tools activity (`showTools`)
> - Agents status (`showAgents`)
> - Todo progress (`showTodos`)

Allow multiple selections or "none".

### A4. Turn on elements

Show the user which elements are currently OFF, then ask:

> **Want to turn anything ON?** Select any you'd like to show:

List only the elements that are currently OFF. Allow multiple selections or "none".

### A5. Preview and save

Show a preview of what the statusline will look like with their config, using a text mockup like:

```text
Line 1: Max  Today $3.40  Week $22  Monthly Saving +$180
Line 2: 5h ●●○○○○○○○○ 15%  7d ●●○○○○○○○○ 21%  Current Context ●●●○○○○○○○ 34%
```

(Adjust based on which elements are enabled and the chosen layout.)

Ask: **Does this look good? Save it?**

If yes, write the config file. If no, restart from A1.

---

## Flow B: Returning User (config exists)

### B1. Show current config

Read the config file and display the current settings in a summary table:

| Setting | Value |
|---------|-------|
| Layout | expanded/compact |
| Preset | full/minimal/custom |
| 5h quota | on/off |
| ... | ... |

### B2. Choose action

Ask the user:

> **What would you like to change?**
>
> 1. **Turn off elements** — hide specific features
> 2. **Turn on elements** — show specific features
> 3. **Change layout** — switch between expanded/compact
> 4. **Reset to preset** — start fresh from a preset
> 5. **Done** — keep current settings

### B3. Execute action

- **Turn off/on**: Show relevant elements (currently on/off) and let user multi-select, same as A3/A4.
- **Change layout**: Toggle between expanded/compact.
- **Reset to preset**: Ask which preset, then apply it (goes back to B1 to review).
- **Done**: Exit.

After each action, show updated preview (same as A5) and confirm save.

---

## Config file format

The config file is JSON at `~/.claude/plugins/claude-office/config.json`:

```json
{
  "preset": "full",
  "display": {
    "lineLayout": "expanded",
    "showQuota5h": true,
    "showQuota7d": true,
    "showContext": true,
    "showToday": true,
    "showWeek": true,
    "showMonth": true,
    "showSaving": true,
    "showTools": true,
    "showAgents": true,
    "showTodos": true
  }
}
```

**Rules:**
- `preset` is always saved to indicate the starting point.
- `display` contains only overrides from the preset defaults. If a value matches the preset default, omit it from `display` to keep the file clean.
- Always include `lineLayout` in `display` since it's the user's explicit layout choice.
- `showPlan` is always true and not configurable — the plan name always shows.
- Ensure `~/.claude/plugins/claude-office/` directory exists before writing (create it if needed).

## Summary

After saving, tell the user:

> Configuration saved! Your changes will take effect immediately.
>
> You can re-run `/claude-office:configure` anytime to adjust settings.
