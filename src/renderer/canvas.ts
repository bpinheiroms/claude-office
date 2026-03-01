import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';

const BG_COLOR = '#2D2A24';

export class CanvasRenderer {
  private canvas: Canvas;
  private ctx: SKRSContext2D;

  constructor(width: number, height: number) {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(): void {
    this.ctx.fillStyle = BG_COLOR;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  drawImageData(imageData: ImageData, x: number, y: number): void {
    this.ctx.putImageData(imageData as any, Math.round(x), Math.round(y));
  }

  drawImageDataScaled(imageData: ImageData, x: number, y: number, destW: number, destH: number): void {
    // Create a temp canvas from the imageData, then drawImage scaled
    const tmpCanvas = createCanvas(imageData.width, imageData.height);
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.putImageData(imageData as any, 0, 0);
    this.ctx.drawImage(tmpCanvas, Math.round(x), Math.round(y), destW, destH);
  }

  drawText(text: string, x: number, y: number, color: string, fontSize: number = 10): void {
    this.ctx.fillStyle = color;
    this.ctx.font = `${fontSize}px monospace`;
    this.ctx.fillText(text, x, y);
  }

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  getBuffer(): Buffer {
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    return Buffer.from(imageData.data.buffer);
  }

  getWidth(): number {
    return this.canvas.width;
  }

  getHeight(): number {
    return this.canvas.height;
  }

  resize(width: number, height: number): void {
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }
}
