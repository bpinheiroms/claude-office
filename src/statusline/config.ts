/**
 * Configuration for the statusline display.
 * Reads from ~/.claude/plugins/claude-office/config.json with preset support.
 */

import { join } from 'path';
import { homedir } from 'os';

const CACHE_DIR = join(homedir(), '.claude', 'plugins', 'claude-office');
const CONFIG_PATH = join(CACHE_DIR, 'config.json');

export type LineLayout = 'expanded' | 'compact';

export interface DisplayConfig {
  lineLayout: LineLayout;
  showPlan: boolean;
  showQuota5h: boolean;
  showQuota7d: boolean;
  showContext: boolean;
  showToday: boolean;
  showWeek: boolean;
  showMonth: boolean;
  showSaving: boolean;
  showTools: boolean;
  showAgents: boolean;
  showTodos: boolean;
}

export type Preset = 'full' | 'minimal';

const PRESETS: Record<Preset, DisplayConfig> = {
  full: {
    lineLayout: 'expanded',
    showPlan: true,
    showQuota5h: true,
    showQuota7d: true,
    showContext: true,
    showToday: true,
    showWeek: true,
    showMonth: true,
    showSaving: true,
    showTools: true,
    showAgents: true,
    showTodos: true,
  },
  minimal: {
    lineLayout: 'compact',
    showPlan: true,
    showQuota5h: true,
    showQuota7d: false,
    showContext: true,
    showToday: true,
    showWeek: false,
    showMonth: false,
    showSaving: true,
    showTools: false,
    showAgents: false,
    showTodos: false,
  },
};

export const DEFAULT_PRESET: Preset = 'minimal';

export interface ConfigFile {
  preset?: Preset;
  display?: Partial<DisplayConfig>;
}

let cachedConfig: DisplayConfig | null = null;
let cachedMtimeMs = 0;

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function presetConfig(preset: Preset): DisplayConfig {
  return { ...PRESETS[preset] };
}

export async function loadConfig(): Promise<DisplayConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    const exists = await file.exists();
    if (!exists) {
      cachedConfig = presetConfig(DEFAULT_PRESET);
      cachedMtimeMs = 0;
      return cachedConfig;
    }

    const stat = await file.stat();
    const mtimeMs = stat?.mtimeMs ?? 0;

    // Return cached if file hasn't changed
    if (cachedConfig && mtimeMs === cachedMtimeMs) {
      return cachedConfig;
    }

    const raw = await file.text();
    const data: ConfigFile = JSON.parse(raw);

    // Start from preset, then override with individual display settings
    const base = presetConfig(data.preset && PRESETS[data.preset] ? data.preset : DEFAULT_PRESET);
    if (data.display) {
      for (const [key, value] of Object.entries(data.display)) {
        if (!(key in base)) continue;
        if (typeof value === 'boolean' || (key === 'lineLayout' && (value === 'expanded' || value === 'compact'))) {
          (base as unknown as Record<string, unknown>)[key] = value;
        }
      }
    }

    cachedConfig = base;
    cachedMtimeMs = mtimeMs;
    return cachedConfig;
  } catch {
    cachedConfig = presetConfig(DEFAULT_PRESET);
    cachedMtimeMs = 0;
    return cachedConfig;
  }
}
