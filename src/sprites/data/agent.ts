import type { SpriteData } from "./types.js";

// 12x16 agent character with animation frames
const W = 12;
const H = 16;

const T: number[] = [0, 0, 0, 0];
const SKIN: number[] = [224, 187, 153, 255];     // skin tone
const HAIR: number[] = [50, 40, 35, 255];        // dark hair
const SHIRT: number[] = [70, 110, 160, 255];     // blue casual shirt
const PANTS: number[] = [60, 65, 80, 255];       // dark pants
const SHOE: number[] = [45, 40, 38, 255];        // dark shoes
const EYE: number[] = [30, 30, 30, 255];         // eyes
const ZZZ: number[] = [180, 180, 220, 255];      // zzz color

type Color = number[];

function createBlankFrame(): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < W * H; i++) {
    pixels.push([...T]);
  }
  return pixels;
}

function set(pixels: number[][], x: number, y: number, c: Color) {
  if (x >= 0 && x < W && y >= 0 && y < H) {
    pixels[y * W + x] = [...c];
  }
}

function drawBaseBody(pixels: number[][]) {
  // Hair (top of head)
  for (let x = 4; x <= 7; x++) set(pixels, x, 0, HAIR);
  for (let x = 3; x <= 8; x++) set(pixels, x, 1, HAIR);

  // Face
  for (let x = 3; x <= 8; x++) set(pixels, x, 2, SKIN);
  for (let x = 3; x <= 8; x++) set(pixels, x, 3, SKIN);
  // Eyes
  set(pixels, 4, 3, EYE);
  set(pixels, 7, 3, EYE);
  // Chin
  for (let x = 4; x <= 7; x++) set(pixels, x, 4, SKIN);

  // Neck
  set(pixels, 5, 5, SKIN);
  set(pixels, 6, 5, SKIN);

  // Shirt/torso
  for (let x = 3; x <= 8; x++) set(pixels, x, 6, SHIRT);
  for (let x = 3; x <= 8; x++) set(pixels, x, 7, SHIRT);
  for (let x = 3; x <= 8; x++) set(pixels, x, 8, SHIRT);
  for (let x = 4; x <= 7; x++) set(pixels, x, 9, SHIRT);

  // Pants
  for (let x = 4; x <= 7; x++) set(pixels, x, 10, PANTS);
  for (let x = 4; x <= 7; x++) set(pixels, x, 11, PANTS);
  for (let x = 4; x <= 7; x++) set(pixels, x, 12, PANTS);

  // Shoes
  set(pixels, 3, 13, SHOE);
  set(pixels, 4, 13, SHOE);
  set(pixels, 7, 13, SHOE);
  set(pixels, 8, 13, SHOE);
}

function buildTypingFrame1(): number[][] {
  const px = createBlankFrame();
  drawBaseBody(px);
  // Arms extended forward (typing position, left arm down)
  set(px, 2, 7, SKIN);
  set(px, 1, 8, SKIN);
  // Right arm down
  set(px, 9, 7, SKIN);
  set(px, 10, 8, SKIN);
  return px;
}

function buildTypingFrame2(): number[][] {
  const px = createBlankFrame();
  drawBaseBody(px);
  // Arms extended forward (typing position, swapped)
  set(px, 2, 8, SKIN);
  set(px, 1, 9, SKIN);
  // Right arm up
  set(px, 9, 7, SKIN);
  set(px, 10, 7, SKIN);
  return px;
}

function buildIdleFrame(): number[][] {
  const px = createBlankFrame();
  drawBaseBody(px);
  // Arms at sides
  set(px, 2, 7, SKIN);
  set(px, 2, 8, SKIN);
  set(px, 9, 7, SKIN);
  set(px, 9, 8, SKIN);
  return px;
}

function buildSleepingFrame(): number[][] {
  const px = createBlankFrame();
  drawBaseBody(px);
  // Head tilted down - override face row
  for (let x = 3; x <= 8; x++) set(px, x, 3, HAIR);
  // Arms relaxed
  set(px, 2, 8, SKIN);
  set(px, 9, 8, SKIN);
  // ZZZ floating above
  set(px, 9, 0, ZZZ);
  set(px, 10, 1, ZZZ);
  set(px, 11, 0, ZZZ);
  return px;
}

export const agentSprite: SpriteData = {
  width: W,
  height: H,
  frames: [
    buildTypingFrame1(),  // frame 0: typing-1
    buildTypingFrame2(),  // frame 1: typing-2
    buildIdleFrame(),     // frame 2: idle
    buildSleepingFrame(), // frame 3: sleeping
  ],
};
