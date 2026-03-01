// claude-office: Live dashboard for Claude Code agents
// Event-driven architecture: file watchers + process tracker + render manager

import { TerminalOutput } from './terminal/output.js';
import { DashboardRenderer } from './terminal/dashboard.js';
import { Collector } from './data/collector.js';
import { DashboardBus } from './events/bus.js';
import { FileWatcher } from './events/file-watcher.js';
import { ProcessTracker } from './events/process-tracker.js';
import { RenderManager } from './events/render-manager.js';
import type { AgentState, QuotaData, UsageSummary } from './data/types.js';
import { getQuota } from './data/quota-api.js';
import { join } from 'path';
import { homedir } from 'os';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const SESSION_DISCOVERY_MS = 10_000;
const USAGE_INTERVAL_MS = 30_000;
const QUOTA_INTERVAL_MS = 60_000;
const MIN_COLS = 40;
const MIN_ROWS = 10;

// --- Debug mode ---
if (process.argv.includes('--debug')) {
  const c = new Collector();
  const [agents, usage, quota] = await Promise.all([c.collect(), c.collectUsage(), getQuota()]);
  console.log(JSON.stringify({ agents, usage, quota }, null, 2));
  process.exit(0);
}

// --- Terminal setup ---
const terminal = new TerminalOutput();
const { cols, rows } = terminal.getSize();

if (cols < MIN_COLS || rows < MIN_ROWS) {
  console.error(`Terminal too small: ${cols}x${rows}. Min: ${MIN_COLS}x${MIN_ROWS}.`);
  process.exit(1);
}

// --- Core components ---
const bus = new DashboardBus();
const dashboard = new DashboardRenderer();
const collector = new Collector();
const fileWatcher = new FileWatcher(bus);
const processTracker = new ProcessTracker(bus);

let scrollOffset = 0;
let usageTimerId: ReturnType<typeof setInterval> | null = null;
let quotaTimerId: ReturnType<typeof setInterval> | null = null;
let discoveryTimerId: ReturnType<typeof setInterval> | null = null;
let collecting = false;

// Stable display state: only updated with valid data, never goes null once set
const display = {
  agents: [] as AgentState[],
  usage: null as UsageSummary | null,
  quota: null as QuotaData | null,
};

// Cached terminal size - updated on SIGWINCH
let cachedCols = cols;
let cachedRows = rows;

function render(): void {
  const output = dashboard.render(display.agents, cachedCols, cachedRows, scrollOffset, -1, display.usage, display.quota);
  terminal.write(output);
}

const renderManager = new RenderManager(bus, render);

async function collectData(): Promise<void> {
  if (collecting) return;
  collecting = true;
  try {
    display.agents = await collector.collect();
  } catch { /* keep previous display.agents */ }
  collecting = false;
}

async function collectUsage(): Promise<void> {
  try {
    const fresh = await collector.collectUsage();
    if (fresh) display.usage = fresh;
  } catch { /* keep previous display.usage */ }
  bus.markDirty();
}

async function collectQuota(): Promise<void> {
  try {
    const fresh = await getQuota();
    // Only accept quota with actual data; never overwrite good data with errors
    if (fresh && fresh.fiveHour != null) {
      display.quota = fresh;
    } else if (!display.quota) {
      // First call, even if error, set it so we show error state
      display.quota = fresh;
    }
    // else: keep previous good display.quota
  } catch { /* keep previous display.quota */ }
  bus.markDirty();
}

// --- Event-driven data refresh ---
bus.on('session:updated', () => { collectData(); });
bus.on('process:changed', () => { collectData(); });

// --- Session discovery (fallback poll for NEW project dirs) ---
async function discoverNewSessions(): Promise<void> {
  await fileWatcher.watchAll(PROJECTS_DIR);
}

function setupInput(): void {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  process.stdin.on('data', (key: string) => {
    if (key === '\u0003' || key === 'q') { cleanup(); return; }
    switch (key) {
      case 'j': scrollOffset = Math.min(scrollOffset + 1, Math.max(0, display.agents.length - 1)); break;
      case 'k': scrollOffset = Math.max(scrollOffset - 1, 0); break;
    }
    renderManager.renderNow();
  });
}

function handleResize(): void {
  const size = terminal.getSize();
  cachedCols = size.cols;
  cachedRows = size.rows;
  scrollOffset = 0;
  renderManager.renderNow();
}

function cleanup(): void {
  fileWatcher.destroy();
  processTracker.stop();
  renderManager.stop();
  bus.destroy();
  if (usageTimerId) clearInterval(usageTimerId);
  if (quotaTimerId) clearInterval(quotaTimerId);
  if (discoveryTimerId) clearInterval(discoveryTimerId);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
  terminal.leave();
  process.exit(0);
}

async function main(): Promise<void> {
  terminal.enter();
  terminal.onResize(handleResize);
  setupInput();

  // Load all data before first render to avoid flickering
  await Promise.all([collectData(), collectUsage(), collectQuota()]);
  render();

  // Set up file watchers for all known project dirs
  await discoverNewSessions();

  // Start event-driven subsystems
  processTracker.start();
  renderManager.start();

  // Periodic discovery for NEW project dirs (not data re-collection)
  discoveryTimerId = setInterval(discoverNewSessions, SESSION_DISCOVERY_MS);

  // Usage collection stays on its own timer (already efficient with mtime cache)
  usageTimerId = setInterval(collectUsage, USAGE_INTERVAL_MS);

  // Quota from Anthropic API (has its own 60s file cache, poll every 60s)
  quotaTimerId = setInterval(collectQuota, QUOTA_INTERVAL_MS);
}

main().catch((err) => {
  terminal.leave();
  console.error('Fatal error:', err);
  process.exit(1);
});
