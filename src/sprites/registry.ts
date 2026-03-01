import { createCanvas } from "@napi-rs/canvas";
import type { SpriteData } from "./data/types.js";
import { floorSprite } from "./data/floor.js";
import { deskSprite } from "./data/desk.js";
import { agentSprite } from "./data/agent.js";
import {
  plantSprite,
  coffeeMachineSprite,
  whiteboardSprite,
} from "./data/furniture.js";

export type { SpriteData } from "./data/types.js";

const spriteMap: Record<string, SpriteData> = {
  floor: floorSprite,
  desk: deskSprite,
  agent: agentSprite,
  plant: plantSprite,
  coffeeMachine: coffeeMachineSprite,
  whiteboard: whiteboardSprite,
};

interface CacheEntry {
  imageData: ImageData;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(name: string, frame: number): string {
  return `${name}:${frame}`;
}

function buildImageData(sprite: SpriteData, frameIndex: number): ImageData {
  const frame = sprite.frames[frameIndex];
  if (!frame) {
    throw new Error(`Frame ${frameIndex} not found for sprite`);
  }

  const { width, height } = sprite;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0; i < frame.length; i++) {
    const pixel = frame[i];
    const offset = i * 4;
    data[offset] = pixel[0];     // R
    data[offset + 1] = pixel[1]; // G
    data[offset + 2] = pixel[2]; // B
    data[offset + 3] = pixel[3]; // A
  }

  return imageData as unknown as ImageData;
}

/**
 * Get a sprite as ImageData. Results are cached after first access.
 */
export function getSprite(name: string, frame: number = 0): ImageData {
  const key = cacheKey(name, frame);
  const cached = cache.get(key);
  if (cached) return cached.imageData;

  const sprite = spriteMap[name];
  if (!sprite) {
    throw new Error(`Unknown sprite: "${name}". Available: ${Object.keys(spriteMap).join(", ")}`);
  }

  const imageData = buildImageData(sprite, frame);
  cache.set(key, { imageData });
  return imageData;
}

/**
 * Get the dimensions of a sprite.
 */
export function getSpriteSize(name: string): { width: number; height: number } {
  const sprite = spriteMap[name];
  if (!sprite) {
    throw new Error(`Unknown sprite: "${name}". Available: ${Object.keys(spriteMap).join(", ")}`);
  }
  return { width: sprite.width, height: sprite.height };
}

/**
 * Get the number of frames for a sprite.
 */
export function getSpriteFrameCount(name: string): number {
  const sprite = spriteMap[name];
  if (!sprite) {
    throw new Error(`Unknown sprite: "${name}". Available: ${Object.keys(spriteMap).join(", ")}`);
  }
  return sprite.frames.length;
}

/**
 * Get raw sprite data (without ImageData conversion).
 */
export function getSpriteData(name: string): SpriteData {
  const sprite = spriteMap[name];
  if (!sprite) {
    throw new Error(`Unknown sprite: "${name}". Available: ${Object.keys(spriteMap).join(", ")}`);
  }
  return sprite;
}

/**
 * List all available sprite names.
 */
export function listSprites(): string[] {
  return Object.keys(spriteMap);
}
