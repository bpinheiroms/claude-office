import type { Encoder } from './halfblock.js';
import { deflateSync } from 'node:zlib';

const CHUNK_SIZE = 4096;

export class KittyEncoder implements Encoder {
  private frameId = 1;

  encode(buffer: Buffer, width: number, height: number): string {
    const compressed = deflateSync(buffer, { level: 1 }); // fast compression
    const b64 = compressed.toString('base64');

    const chunks: string[] = [];
    for (let i = 0; i < b64.length; i += CHUNK_SIZE) {
      chunks.push(b64.slice(i, i + CHUNK_SIZE));
    }

    // Clear previous image and position cursor
    const out: string[] = [
      '\x1b_Ga=d,q=2;\x1b\\', // delete all images, quiet
      '\x1b[H',                // cursor home
    ];

    if (chunks.length === 0) return out.join('');

    if (chunks.length === 1) {
      out.push(`\x1b_Gf=32,s=${width},v=${height},m=0,a=T,o=z,q=2;${chunks[0]}\x1b\\`);
    } else {
      out.push(`\x1b_Gf=32,s=${width},v=${height},m=1,a=T,o=z,q=2;${chunks[0]}\x1b\\`);
      for (let i = 1; i < chunks.length - 1; i++) {
        out.push(`\x1b_Gm=1,q=2;${chunks[i]}\x1b\\`);
      }
      out.push(`\x1b_Gm=0,q=2;${chunks[chunks.length - 1]}\x1b\\`);
    }

    return out.join('');
  }
}
