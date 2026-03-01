import { EventEmitter } from 'events';

export type DashboardEvent =
  | { type: 'session:updated'; sessionId: string; projectDir: string; jsonlPath: string }
  | { type: 'session:new'; projectDir: string }
  | { type: 'session:removed'; sessionId: string }
  | { type: 'process:changed'; liveProcs: Set<string> }
  | { type: 'usage:stale' }
  | { type: 'data:dirty' }
  | { type: 'render:request' };

export class DashboardBus extends EventEmitter {
  private dirty = false;
  private renderScheduled = false;
  private renderInterval = 200;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  markDirty(): void {
    this.dirty = true;
    this.emit('data:dirty');
    this.scheduleRender();
  }

  isDirty(): boolean { return this.dirty; }
  clearDirty(): void { this.dirty = false; }

  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    setTimeout(() => {
      this.renderScheduled = false;
      if (this.dirty) this.emit('render:request');
    }, this.renderInterval);
  }

  destroy(): void { this.removeAllListeners(); }
}
