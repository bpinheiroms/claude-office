import type { SpriteData } from "./types.js";

// 24x20 isometric desk with monitor
const W = 24;
const H = 20;

const T: number[] = [0, 0, 0, 0];
const WOOD: number[] = [139, 115, 85, 255];       // #8B7355 desk surface
const WOOD_DARK: number[] = [115, 93, 68, 255];   // darker wood for legs/sides
const MONITOR: number[] = [50, 50, 60, 255];      // monitor bezel
const SCREEN_ON: number[] = [74, 154, 218, 255];  // #4A9ADA screen glow
const SCREEN_OFF: number[] = [30, 30, 35, 255];   // screen off
const SCREEN_WARN: number[] = [250, 204, 21, 255]; // yellow status
const SCREEN_ERR: number[] = [239, 68, 68, 255];  // red status
const STAND: number[] = [60, 60, 70, 255];        // monitor stand

type Color = number[];

function buildDeskFrame(screenColor: Color): number[][] {
  const pixels: number[][] = [];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      pixels.push([...T]);
    }
  }

  const set = (x: number, y: number, c: Color) => {
    if (x >= 0 && x < W && y >= 0 && y < H) {
      pixels[y * W + x] = [...c];
    }
  };

  // --- Desk surface (isometric parallelogram) rows 12-16 ---
  for (let y = 12; y <= 16; y++) {
    const offset = y - 12;
    for (let x = 2 + offset; x < 22 + offset && x < W; x++) {
      set(x, y, WOOD);
    }
  }
  // desk front edge highlight
  for (let x = 6; x < 24; x++) {
    set(x, 16, WOOD_DARK);
  }

  // --- Desk legs ---
  for (let y = 17; y <= 19; y++) {
    set(4, y, WOOD_DARK);
    set(5, y, WOOD_DARK);
    set(21, y, WOOD_DARK);
    set(22, y, WOOD_DARK);
  }

  // --- Monitor ---
  // Monitor bezel (rows 2-10, centered on desk)
  for (let y = 2; y <= 10; y++) {
    for (let x = 7; x <= 17; x++) {
      set(x, y, MONITOR);
    }
  }
  // Screen area inside bezel
  for (let y = 3; y <= 9; y++) {
    for (let x = 8; x <= 16; x++) {
      set(x, y, screenColor);
    }
  }
  // Monitor stand
  for (let y = 11; y <= 12; y++) {
    set(11, y, STAND);
    set(12, y, STAND);
    set(13, y, STAND);
  }

  return pixels;
}

export const deskSprite: SpriteData = {
  width: W,
  height: H,
  frames: [
    buildDeskFrame(SCREEN_ON),    // frame 0: monitor on (blue)
    buildDeskFrame(SCREEN_WARN),  // frame 1: monitor warning (yellow)
    buildDeskFrame(SCREEN_ERR),   // frame 2: monitor error (red)
    buildDeskFrame(SCREEN_OFF),   // frame 3: monitor off
  ],
};
