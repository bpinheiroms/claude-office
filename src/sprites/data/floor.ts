import type { SpriteData } from "./types.js";

// 16x16 isometric floor tile - wood-tone checkerboard diamond
const W = 16;
const H = 16;

const LIGHT: [number, number, number, number] = [160, 137, 108, 255]; // #A0896C
const DARK: [number, number, number, number] = [139, 115, 85, 255];   // #8B7355
const T: [number, number, number, number] = [0, 0, 0, 0];             // transparent

function buildFloorTile(): number[][] {
  const pixels: number[][] = [];
  const cx = W / 2;
  const cy = H / 2;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Isometric diamond: |x - cx| / cx + |y - cy| / cy <= 1
      const dx = Math.abs(x - cx + 0.5) / cx;
      const dy = Math.abs(y - cy + 0.5) / cy;

      if (dx + dy <= 1.0) {
        // Checkerboard pattern in isometric space
        const isoX = (x - y + H) >> 2;
        const isoY = (x + y) >> 2;
        const isLight = (isoX + isoY) % 2 === 0;
        pixels.push([...(isLight ? LIGHT : DARK)]);
      } else {
        pixels.push([...T]);
      }
    }
  }

  return pixels;
}

export const floorSprite: SpriteData = {
  width: W,
  height: H,
  frames: [buildFloorTile()],
};
