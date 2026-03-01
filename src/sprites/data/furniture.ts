import type { SpriteData } from "./types.js";

const T: number[] = [0, 0, 0, 0];

type Color = number[];

function createBlank(w: number, h: number): number[][] {
  const pixels: number[][] = [];
  for (let i = 0; i < w * h; i++) pixels.push([...T]);
  return pixels;
}

function set(pixels: number[][], w: number, x: number, y: number, c: Color) {
  if (x >= 0 && x < w && y >= 0) {
    pixels[y * w + x] = [...c];
  }
}

// --- Plant: 12x16 ---
function buildPlant(): number[][] {
  const W = 12, H = 16;
  const px = createBlank(W, H);

  const LEAF: Color = [74, 138, 58, 255];       // #4A8A3A
  const LEAF_LT: Color = [95, 160, 75, 255];    // lighter leaf
  const POT: Color = [160, 100, 60, 255];        // terracotta
  const POT_DK: Color = [130, 80, 48, 255];      // pot shadow
  const SOIL: Color = [80, 60, 40, 255];          // soil
  const STEM: Color = [60, 110, 45, 255];         // stem

  // Leaves (top canopy)
  for (let x = 3; x <= 8; x++) set(px, W, x, 0, LEAF);
  for (let x = 2; x <= 9; x++) set(px, W, x, 1, LEAF_LT);
  for (let x = 1; x <= 10; x++) set(px, W, x, 2, LEAF);
  for (let x = 2; x <= 9; x++) set(px, W, x, 3, LEAF_LT);
  for (let x = 3; x <= 8; x++) set(px, W, x, 4, LEAF);
  for (let x = 4; x <= 7; x++) set(px, W, x, 5, LEAF_LT);

  // Stem
  set(px, W, 5, 6, STEM);
  set(px, W, 6, 6, STEM);
  set(px, W, 5, 7, STEM);
  set(px, W, 6, 7, STEM);
  set(px, W, 5, 8, STEM);
  set(px, W, 6, 8, STEM);

  // Soil
  for (let x = 3; x <= 8; x++) set(px, W, x, 9, SOIL);

  // Pot
  for (let x = 3; x <= 8; x++) set(px, W, x, 10, POT);
  for (let x = 3; x <= 8; x++) set(px, W, x, 11, POT);
  for (let x = 3; x <= 8; x++) set(px, W, x, 12, POT_DK);
  for (let x = 4; x <= 7; x++) set(px, W, x, 13, POT_DK);

  return px;
}

// --- Coffee Machine: 12x14 ---
function buildCoffeeMachine(): number[][] {
  const W = 12, H = 14;
  const px = createBlank(W, H);

  const BODY: Color = [70, 70, 75, 255];         // dark metal
  const BODY_LT: Color = [90, 90, 95, 255];      // lighter metal
  const ACCENT: Color = [200, 50, 50, 255];       // red accent
  const SPOUT: Color = [50, 50, 55, 255];         // dark spout
  const CUP: Color = [220, 220, 215, 255];        // white cup
  const COFFEE: Color = [90, 60, 30, 255];        // coffee color

  // Top of machine
  for (let x = 3; x <= 8; x++) set(px, W, x, 0, BODY_LT);
  for (let x = 2; x <= 9; x++) set(px, W, x, 1, BODY);
  // Accent stripe
  for (let x = 2; x <= 9; x++) set(px, W, x, 2, ACCENT);
  // Body
  for (let y = 3; y <= 7; y++) {
    for (let x = 2; x <= 9; x++) set(px, W, x, y, BODY);
  }
  // Display/button area
  set(px, W, 4, 4, BODY_LT);
  set(px, W, 5, 4, BODY_LT);
  set(px, W, 7, 4, ACCENT);

  // Spout area
  set(px, W, 5, 8, SPOUT);
  set(px, W, 6, 8, SPOUT);
  set(px, W, 5, 9, SPOUT);
  set(px, W, 6, 9, SPOUT);

  // Cup
  for (let x = 4; x <= 7; x++) set(px, W, x, 10, CUP);
  for (let x = 4; x <= 7; x++) set(px, W, x, 11, CUP);
  set(px, W, 5, 10, COFFEE);
  set(px, W, 6, 10, COFFEE);

  // Base
  for (let x = 2; x <= 9; x++) set(px, W, x, 12, BODY);
  for (let x = 2; x <= 9; x++) set(px, W, x, 13, BODY_LT);

  return px;
}

// --- Whiteboard: 20x16 ---
function buildWhiteboard(): number[][] {
  const W = 20, H = 16;
  const px = createBlank(W, H);

  const FRAME: Color = [120, 120, 125, 255];     // aluminum frame
  const BOARD: Color = [245, 245, 240, 255];      // white board surface
  const MARKER: Color = [50, 100, 200, 255];      // blue marker writing
  const MARKER2: Color = [200, 60, 60, 255];      // red marker
  const STAND: Color = [90, 90, 95, 255];          // stand legs
  const TRAY: Color = [100, 100, 105, 255];        // marker tray

  // Frame top
  for (let x = 1; x <= 18; x++) set(px, W, x, 0, FRAME);

  // Board with frame sides
  for (let y = 1; y <= 10; y++) {
    set(px, W, 1, y, FRAME);
    for (let x = 2; x <= 17; x++) set(px, W, x, y, BOARD);
    set(px, W, 18, y, FRAME);
  }

  // Some scribbles on the board
  for (let x = 3; x <= 8; x++) set(px, W, x, 2, MARKER);
  for (let x = 4; x <= 10; x++) set(px, W, x, 4, MARKER);
  for (let x = 3; x <= 6; x++) set(px, W, x, 6, MARKER2);
  for (let x = 12; x <= 16; x++) set(px, W, x, 3, MARKER);
  for (let x = 11; x <= 15; x++) set(px, W, x, 5, MARKER);
  // A little box diagram
  for (let x = 12; x <= 16; x++) set(px, W, x, 7, MARKER);
  set(px, W, 12, 8, MARKER);
  set(px, W, 16, 8, MARKER);
  for (let x = 12; x <= 16; x++) set(px, W, x, 9, MARKER);

  // Frame bottom
  for (let x = 1; x <= 18; x++) set(px, W, x, 11, FRAME);

  // Marker tray
  for (let x = 5; x <= 14; x++) set(px, W, x, 12, TRAY);

  // Stand legs
  set(px, W, 4, 13, STAND);
  set(px, W, 3, 14, STAND);
  set(px, W, 2, 15, STAND);
  set(px, W, 15, 13, STAND);
  set(px, W, 16, 14, STAND);
  set(px, W, 17, 15, STAND);

  return px;
}

export const plantSprite: SpriteData = {
  width: 12,
  height: 16,
  frames: [buildPlant()],
};

export const coffeeMachineSprite: SpriteData = {
  width: 12,
  height: 14,
  frames: [buildCoffeeMachine()],
};

export const whiteboardSprite: SpriteData = {
  width: 20,
  height: 16,
  frames: [buildWhiteboard()],
};
