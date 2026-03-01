import type { DashboardBus } from './bus.js';

const MIN_RENDER_INTERVAL_MS = 200;
const IDLE_TICK_MS = 2_000;

export class RenderManager {
  private bus: DashboardBus;
  private renderFn: () => void;
  private lastRenderTime = 0;
  private pendingRender = false;
  private coalescingTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bus: DashboardBus, renderFn: () => void) {
    this.bus = bus;
    this.renderFn = renderFn;
  }

  start(): void {
    // Listen for render requests from the bus
    this.bus.on('render:request', () => this.scheduleRender());

    // Idle timer for clock/elapsed time updates even when no data changes
    this.idleTimer = setInterval(() => {
      this.doRender();
    }, IDLE_TICK_MS);
  }

  /** Request a render, coalesced to MIN_RENDER_INTERVAL_MS */
  scheduleRender(): void {
    const now = Date.now();
    const elapsed = now - this.lastRenderTime;

    if (elapsed >= MIN_RENDER_INTERVAL_MS) {
      // Enough time has passed, render immediately
      this.doRender();
    } else if (!this.pendingRender) {
      // Schedule render after remaining cooldown
      this.pendingRender = true;
      this.coalescingTimer = setTimeout(() => {
        this.pendingRender = false;
        this.coalescingTimer = null;
        this.doRender();
      }, MIN_RENDER_INTERVAL_MS - elapsed);
    }
    // If already pending, the scheduled render will handle it
  }

  private doRender(): void {
    this.lastRenderTime = Date.now();
    this.bus.clearDirty();
    try {
      this.renderFn();
    } catch {
      // Render errors should not crash the dashboard
    }
  }

  /** Force an immediate render, bypassing coalescing */
  renderNow(): void {
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
      this.pendingRender = false;
    }
    this.doRender();
  }

  stop(): void {
    if (this.coalescingTimer) {
      clearTimeout(this.coalescingTimer);
      this.coalescingTimer = null;
    }
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    this.pendingRender = false;
  }
}
