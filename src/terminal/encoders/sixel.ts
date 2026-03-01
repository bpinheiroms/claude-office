import type { Encoder } from './halfblock.js';
import { image2sixel } from 'sixel';

export class SixelEncoder implements Encoder {
  encode(buffer: Buffer, width: number, height: number): string {
    // image2sixel expects Uint8Array of RGBA data
    const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // Encode to sixel with up to 256 colors, transparent background
    const sixelData = image2sixel(data, width, height, 256, 1);

    // Position cursor at home and output sixel sequence
    return `\x1b[H${sixelData}`;
  }
}
