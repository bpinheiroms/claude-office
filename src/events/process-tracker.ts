import { exec } from 'child_process';
import { promisify } from 'util';
import type { DashboardBus } from './bus.js';

const execAsync = promisify(exec);
const PROCESS_POLL_MS = 15_000;

export class ProcessTracker {
  private liveProcs = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private bus: DashboardBus;

  constructor(bus: DashboardBus) { this.bus = bus; }

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), PROCESS_POLL_MS);
  }

  private async refresh(): Promise<void> {
    const newProcs = await this.discoverLiveProcesses();
    if (!setsEqual(this.liveProcs, newProcs)) {
      this.liveProcs = newProcs;
      this.bus.emit('process:changed', { type: 'process:changed', liveProcs: this.liveProcs });
      this.bus.markDirty();
    }
  }

  private async discoverLiveProcesses(): Promise<Set<string>> {
    const live = new Set<string>();
    try {
      // Single combined ps call - non-blocking async
      const { stdout } = await execAsync(
        "ps -Eww -o pid,comm 2>/dev/null | grep 'claude$'",
        { timeout: 3000 }
      );
      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const pwdMatch = line.match(/PWD=([^\s]+)/);
        if (pwdMatch) {
          const projDir = pwdMatch[1].replace(/[/.]/g, '-');
          live.add(projDir);
        }
      }
    } catch { /* no processes or timeout */ }
    return live;
  }

  getLiveProcs(): Set<string> { return this.liveProcs; }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
