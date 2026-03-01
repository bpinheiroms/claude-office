export interface SceneEntity {
  id: string;
  x: number;           // grid x
  y: number;           // grid y
  spriteName: string;
  spriteFrame: number;
  label?: string;
  labelColor?: string;
  // Extra data for rich rendering
  activity?: string;
  toolBubble?: string;   // e.g. "⌘ Bash" shown as speech bubble
  subAgentCount?: number;
}

export class SceneGraph {
  private entities: SceneEntity[] = [];
  private offsetX: number = 0;
  private offsetY: number = 0;
  private tileWidth: number;
  private tileHeight: number;

  constructor(tileWidth: number = 32, tileHeight: number = 16) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }

  setOffset(x: number, y: number): void {
    this.offsetX = x;
    this.offsetY = y;
  }

  getTileSize(): { width: number; height: number } {
    return { width: this.tileWidth, height: this.tileHeight };
  }

  clear(): void {
    this.entities = [];
  }

  addEntity(entity: SceneEntity): void {
    this.entities.push(entity);
  }

  removeEntity(id: string): void {
    this.entities = this.entities.filter(e => e.id !== id);
  }

  isoToScreen(gridX: number, gridY: number): { x: number; y: number } {
    return {
      x: (gridX - gridY) * (this.tileWidth / 2) + this.offsetX,
      y: (gridX + gridY) * (this.tileHeight / 4) + this.offsetY,
    };
  }

  getSortedEntities(): SceneEntity[] {
    return [...this.entities].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  }
}
