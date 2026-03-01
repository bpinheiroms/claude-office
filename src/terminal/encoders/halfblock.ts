export interface Encoder {
  encode(buffer: Buffer, width: number, height: number): string;
}

const TRANSPARENT_THRESHOLD = 128;

export class HalfBlockEncoder implements Encoder {
  private prevFrame: string[] | null = null;
  private cells: string[] = [];
  private cellsLen = 0;
  private out: string[] = [];
  private colorCache = new Map<number, string>();

  private fgColor(r: number, g: number, b: number): string {
    const key = (r << 16) | (g << 8) | b;
    let s = this.colorCache.get(key);
    if (s === undefined) {
      s = `\x1b[38;2;${r};${g};${b}m`;
      this.colorCache.set(key, s);
    }
    return s;
  }

  private fgBgColor(tr: number, tg: number, tb: number, br: number, bg: number, bb: number): string {
    const key = ((tr << 16) | (tg << 8) | tb) * 16777259 + ((br << 16) | (bg << 8) | bb);
    let s = this.colorCache.get(key);
    if (s === undefined) {
      s = `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m`;
      this.colorCache.set(key, s);
    }
    return s;
  }

  encode(buffer: Buffer, width: number, height: number): string {
    const termRows = Math.ceil(height / 2);
    const neededLen = termRows * width;

    // Reuse cells array, only reallocate when dimensions change
    if (this.cellsLen !== neededLen) {
      this.cells = new Array(neededLen);
      this.cellsLen = neededLen;
    }
    const cells = this.cells;

    // Reuse out array
    this.out.length = 0;
    const out = this.out;

    for (let ty = 0; ty < termRows; ty++) {
      const topY = ty * 2;
      const botY = topY + 1;

      for (let x = 0; x < width; x++) {
        const topIdx = (topY * width + x) * 4;
        const botIdx = botY < height ? (botY * width + x) * 4 : -1;

        const topR = buffer[topIdx];
        const topG = buffer[topIdx + 1];
        const topB = buffer[topIdx + 2];
        const topA = buffer[topIdx + 3];

        const topOpaque = topA >= TRANSPARENT_THRESHOLD;

        let botR = 0, botG = 0, botB = 0;
        let botOpaque = false;
        if (botIdx >= 0) {
          botR = buffer[botIdx];
          botG = buffer[botIdx + 1];
          botB = buffer[botIdx + 2];
          botOpaque = buffer[botIdx + 3] >= TRANSPARENT_THRESHOLD;
        }

        let cell: string;

        if (!topOpaque && !botOpaque) {
          cell = ' ';
        } else if (topOpaque && botOpaque && topR === botR && topG === botG && topB === botB) {
          cell = `${this.fgColor(topR, topG, topB)}\u2588`;
        } else if (topOpaque && botOpaque) {
          cell = `${this.fgBgColor(topR, topG, topB, botR, botG, botB)}\u2580`;
        } else if (!topOpaque && botOpaque) {
          cell = `${this.fgColor(botR, botG, botB)}\u2584`;
        } else {
          // topOpaque && !botOpaque
          cell = `${this.fgColor(topR, topG, topB)}\u2580`;
        }

        cells[ty * width + x] = cell;
      }
    }

    // Diff against previous frame
    if (this.prevFrame && this.prevFrame.length === cells.length) {
      for (let ty = 0; ty < termRows; ty++) {
        let lineHasChanges = false;
        for (let x = 0; x < width; x++) {
          const idx = ty * width + x;
          if (cells[idx] !== this.prevFrame[idx]) {
            lineHasChanges = true;
            break;
          }
        }
        if (!lineHasChanges) continue;

        let x = 0;
        while (x < width) {
          const idx = ty * width + x;
          if (cells[idx] === this.prevFrame[idx]) {
            x++;
            continue;
          }
          // Position cursor (1-based)
          out.push(`\x1b[${ty + 1};${x + 1}H`);
          // Emit contiguous changed cells
          while (x < width && cells[ty * width + x] !== this.prevFrame[ty * width + x]) {
            out.push(cells[ty * width + x]);
            x++;
          }
          out.push('\x1b[0m');
        }
      }
    } else {
      // Full frame render (first frame or size change)
      for (let ty = 0; ty < termRows; ty++) {
        out.push(`\x1b[${ty + 1};1H`);
        for (let x = 0; x < width; x++) {
          out.push(cells[ty * width + x]);
        }
        out.push('\x1b[0m');
      }
    }

    this.prevFrame = cells.slice();
    return out.join('');
  }

  reset(): void {
    this.prevFrame = null;
    this.cells = [];
    this.cellsLen = 0;
    this.out = [];
    this.colorCache.clear();
  }
}
