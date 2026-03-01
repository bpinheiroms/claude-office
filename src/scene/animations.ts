import type { AgentActivity } from '../data/types.js';

const ACTIVITY_BASE_FRAME: Record<AgentActivity, number> = {
  active: 0,
  idle: 1,
  sleeping: 2,
};

export class AnimationController {
  private frameCount: number = 0;

  tick(): void {
    this.frameCount++;
  }

  getAgentFrame(activity: AgentActivity): number {
    return ACTIVITY_BASE_FRAME[activity] ?? 0;
  }

  getZzzOffset(): { x: number; y: number; opacity: number } {
    // Zzz floats upward in a sine wave, looping every 60 frames
    const cycle = this.frameCount % 60;
    const t = cycle / 60;
    return {
      x: Math.sin(t * Math.PI * 2) * 3,
      y: -t * 12,
      opacity: 1 - t,
    };
  }

  getFrameCount(): number {
    return this.frameCount;
  }
}
