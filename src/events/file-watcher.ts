import { watch, type FSWatcher } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import type { DashboardBus } from './bus.js';

const DEBOUNCE_MS = 150;
const MAX_WATCHERS = 200;

export class FileWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private bus: DashboardBus;

  constructor(bus: DashboardBus) {
    this.bus = bus;
  }

  /** Watch a project directory for .jsonl file changes */
  watchDirectory(projectDir: string, dirPath: string): void {
    if (this.watchers.has(dirPath)) return;
    if (this.watchers.size >= MAX_WATCHERS) return;

    try {
      const watcher = watch(dirPath, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        this.debouncedNotify(projectDir, dirPath, filename);
      });

      watcher.on('error', (err) => {
        // Gracefully handle watcher errors (directory deleted, permission change, etc.)
        this.unwatchDirectory(dirPath);
      });

      this.watchers.set(dirPath, watcher);
    } catch {
      // Directory may not exist or be inaccessible
    }
  }

  private debouncedNotify(projectDir: string, dirPath: string, filename: string): void {
    const key = join(dirPath, filename);
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      const sessionId = filename.replace('.jsonl', '');
      const jsonlPath = join(dirPath, filename);
      this.bus.emit('session:updated', {
        type: 'session:updated',
        sessionId,
        projectDir,
        jsonlPath,
      });
      this.bus.markDirty();
    }, DEBOUNCE_MS));
  }

  unwatchDirectory(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      this.watchers.delete(dirPath);
    }
    // Clear any pending debounce timers for this directory
    for (const [key, timer] of this.debounceTimers) {
      if (key.startsWith(dirPath)) {
        clearTimeout(timer);
        this.debounceTimers.delete(key);
      }
    }
  }

  /** Scan project directories and set up watchers for all known projects */
  async watchAll(projectsDir: string): Promise<void> {
    try {
      const dirs = await readdir(projectsDir);
      for (const dir of dirs) {
        if (dir === '-') continue;
        const dirPath = join(projectsDir, dir);
        this.watchDirectory(dir, dirPath);
      }
    } catch {
      // projects directory may not exist yet
    }
  }

  getWatcherCount(): number {
    return this.watchers.size;
  }

  destroy(): void {
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const [, watcher] of this.watchers) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    this.watchers.clear();
  }
}
