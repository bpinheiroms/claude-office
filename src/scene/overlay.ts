import type { CanvasRenderer } from '../renderer/canvas.js';
import type { AgentState } from '../data/types.js';

const HEADER_COLOR = '#E0D8CC';
const FOOTER_COLOR = '#8A8070';
const PANEL_TEXT = '#E0D8CC';
const PANEL_DIM = '#8A8070';
const PANEL_BG = '#1E1C18';
const SLEEP_COLOR = '#6A6560';
const ACTIVE_COLOR = '#4ADE80';
const IDLE_COLOR = '#FACC15';

export class OverlayRenderer {
  renderHeader(ctx: CanvasRenderer, agents: AgentState[], width: number): void {
    const active = agents.filter(a => a.activity === 'active').length;
    const idle = agents.filter(a => a.activity === 'idle').length;
    const sleeping = agents.filter(a => a.activity === 'sleeping').length;
    const subs = agents.reduce((n, a) => n + a.subAgents.length, 0);

    const title = `Claude Office`;
    const stats = `⚡${active}  ◑${idle}  💤${sleeping}${subs > 0 ? `  🤖${subs}` : ''}`;

    ctx.drawText(title, 10, 16, HEADER_COLOR, 13);
    ctx.drawText(stats, width - 180, 16, HEADER_COLOR, 11);
  }

  renderFooter(ctx: CanvasRenderer, width: number, height: number): void {
    ctx.drawText('q:quit  1-9:focus  esc:unfocus  j/k:scroll', 10, height - 6, FOOTER_COLOR, 10);
  }

  renderAgentLabel(ctx: CanvasRenderer, name: string, x: number, y: number, color: string): void {
    ctx.drawText(name, x, y, color, 9);
  }

  renderSleepingList(ctx: CanvasRenderer, agents: AgentState[], width: number, height: number): void {
    const sleeping = agents.filter(a => a.activity === 'sleeping');
    if (sleeping.length === 0) return;

    const panelX = 10;
    const startY = height - 50;
    const lineH = 12;
    const maxLines = 3;

    // Background
    const names = sleeping.map(a => a.sessionName || a.project);
    const lineCount = Math.min(maxLines, Math.ceil(names.length / 6));
    ctx.fillRect(panelX - 4, startY - 14, Math.min(width - 20, 500), lineH * (lineCount + 1) + 4, PANEL_BG);

    ctx.drawText(`💤 ${sleeping.length} sleeping`, panelX, startY - 2, SLEEP_COLOR, 10);

    // Wrap names into lines
    let currentLine = '';
    let lineIdx = 0;
    for (let i = 0; i < names.length; i++) {
      if (lineIdx >= maxLines) break;
      const sep = currentLine.length > 0 ? '  ' : '';
      if (currentLine.length + sep.length + names[i].length > 70) {
        ctx.drawText(currentLine, panelX, startY + lineH * (lineIdx + 1) - 2, SLEEP_COLOR, 9);
        lineIdx++;
        currentLine = names[i];
      } else {
        currentLine += sep + names[i];
      }
    }
    if (currentLine.length > 0 && lineIdx < maxLines) {
      ctx.drawText(currentLine, panelX, startY + lineH * (lineIdx + 1) - 2, SLEEP_COLOR, 9);
    }
  }

  renderFocusPanel(ctx: CanvasRenderer, agent: AgentState, width: number, height: number): void {
    const panelW = Math.min(320, width - 20);
    const panelX = width - panelW - 10;
    const panelY = 30;
    const lineH = 14;

    // Background
    ctx.fillRect(panelX - 4, panelY - 4, panelW + 8, lineH * 7, PANEL_BG);

    const toolStr = agent.lastTool ? `${agent.lastTool.name} ${agent.lastTool.detail}` : '—';
    const subsStr = agent.subAgents.length > 0 ? ` (${agent.subAgents.length} sub-agents)` : '';
    const lines = [
      { text: (agent.sessionName || agent.project) + subsStr, color: PANEL_TEXT, size: 12 },
      { text: `Project: ${agent.project}`, color: PANEL_DIM, size: 10 },
      { text: `Branch: ${agent.gitBranch || '—'}`, color: PANEL_DIM, size: 10 },
      { text: `Last: ${toolStr}`, color: PANEL_DIM, size: 10 },
      { text: `Activity: ${agent.activity}`, color: agent.activity === 'active' ? ACTIVE_COLOR : agent.activity === 'idle' ? IDLE_COLOR : PANEL_DIM, size: 10 },
      { text: agent.summary || '', color: PANEL_DIM, size: 10 },
    ];

    for (let i = 0; i < lines.length; i++) {
      ctx.drawText(lines[i].text, panelX, panelY + i * lineH, lines[i].color, lines[i].size);
    }
  }
}
