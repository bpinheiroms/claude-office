import type { AgentState } from '../data/types.js';
import { SceneGraph } from '../renderer/scene.js';

const DESK_COLS = 3;
const DESK_SPACING_X = 2;
const DESK_SPACING_Y = 2;

const TOOL_ICONS: Record<string, string> = {
  Bash: '>', Edit: 'E', Write: 'W', Read: 'R', Grep: '?',
  Glob: 'G', Agent: 'A', WebFetch: 'W', WebSearch: '?',
  TaskCreate: 'T', TaskUpdate: 'T', SendMessage: 'M',
};

const LABEL_COLORS: Record<string, string> = {
  active: '#4ADE80',
  idle: '#FACC15',
  sleeping: '#94A3B8',
};

export class OfficeLayout {
  private maxAgents: number;

  constructor(maxAgents: number) {
    this.maxAgents = maxAgents;
  }

  buildScene(agents: AgentState[], frameCount: number, canvasWidth: number, canvasHeight: number): SceneGraph {
    // Only show active + idle agents as desks (sleeping ones go to overlay)
    const visibleAgents = agents.filter(a => a.activity !== 'sleeping');
    const agentCount = Math.max(visibleAgents.length, 1);
    const rows = Math.ceil(agentCount / DESK_COLS);
    const gridCols = DESK_COLS * DESK_SPACING_X + 1;
    const gridRows = rows * DESK_SPACING_Y + 1;

    const span = gridCols + gridRows;

    // Target: fill ~70% of canvas (leave room for text overlays)
    const targetW = canvasWidth * 0.70;
    const targetH = canvasHeight * 0.55;

    let tileW = Math.floor(2 * targetW / span);
    let tileH = Math.floor(4 * targetH / span);

    // Maintain 2:1 aspect ratio
    if (tileH > Math.floor(tileW / 2)) {
      tileH = Math.floor(tileW / 2);
    } else {
      tileW = tileH * 2;
    }

    // Min tile size for readability
    tileW = Math.max(40, tileW);
    tileH = Math.max(20, tileH);

    // Max tile size to avoid overly large agents
    tileW = Math.min(120, tileW);
    tileH = Math.min(60, tileH);

    const scene = new SceneGraph(tileW, tileH);

    // Center the diamond
    const midGx = gridCols / 2;
    const midGy = gridRows / 2;
    const offsetX = Math.floor(canvasWidth / 2 - (midGx - midGy) * (tileW / 2));
    const offsetY = Math.floor(canvasHeight * 0.35 - (midGx + midGy) * (tileH / 4));
    scene.setOffset(offsetX, offsetY);

    // Floor tiles
    for (let gy = 0; gy < gridRows; gy++) {
      for (let gx = 0; gx < gridCols; gx++) {
        scene.addEntity({
          id: `f${gx}_${gy}`,
          x: gx,
          y: gy,
          spriteName: 'floor',
          spriteFrame: 0,
        });
      }
    }

    // Corner decorations
    scene.addEntity({ id: 'deco0', x: 0, y: 0, spriteName: 'plant', spriteFrame: 0 });
    if (gridRows > 1) {
      scene.addEntity({ id: 'deco1', x: gridCols - 1, y: 0, spriteName: 'coffeeMachine', spriteFrame: 0 });
    }

    // Desks + Agents (only active/idle)
    for (let i = 0; i < visibleAgents.length; i++) {
      const agent = visibleAgents[i];
      const col = i % DESK_COLS;
      const row = Math.floor(i / DESK_COLS);
      const gx = col * DESK_SPACING_X + 1;
      const gy = row * DESK_SPACING_Y + 1;

      scene.addEntity({
        id: `desk${i}`,
        x: gx,
        y: gy,
        spriteName: 'desk',
        spriteFrame: 0,
      });

      let toolBubble: string | undefined;
      if (agent.lastTool) {
        const icon = TOOL_ICONS[agent.lastTool.name] || '.';
        toolBubble = `${icon} ${agent.lastTool.name}`;
      }

      scene.addEntity({
        id: `agent${i}`,
        x: gx,
        y: gy,
        spriteName: 'agent',
        spriteFrame: agent.activity === 'active' ? (frameCount % 2) : 1,
        label: agent.sessionName || agent.project || `agent-${i + 1}`,
        labelColor: LABEL_COLORS[agent.activity] ?? '#FFFFFF',
        activity: agent.activity,
        toolBubble,
        subAgentCount: agent.subAgents.length,
      });
    }

    // If no visible agents, show an empty office placeholder
    if (visibleAgents.length === 0) {
      scene.addEntity({
        id: 'empty-desk',
        x: 1,
        y: 1,
        spriteName: 'desk',
        spriteFrame: 0,
      });
    }

    return scene;
  }
}
