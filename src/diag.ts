// Diagnostic script - tests each layer of the render pipeline
import { detectProtocol, getCanvasSize } from './terminal/detect.js';
import { CanvasRenderer } from './renderer/canvas.js';
import { HalfBlockEncoder } from './terminal/encoders/halfblock.js';
import { KittyEncoder } from './terminal/encoders/kitty.js';

const proto = detectProtocol();
const size = getCanvasSize(proto);
const cols = process.stdout.columns || 80;
const rows = process.stdout.rows || 24;

console.log(`Protocol: ${proto}`);
console.log(`Terminal: ${cols}x${rows}`);
console.log(`Canvas: ${size.width}x${size.height}`);
console.log(`TERM_PROGRAM: ${process.env.TERM_PROGRAM}`);
console.log(`TERM: ${process.env.TERM}`);
console.log(`KITTY_WINDOW_ID: ${process.env.KITTY_WINDOW_ID}`);
console.log(`ZELLIJ: ${process.env.ZELLIJ}`);
console.log('');

// Test 1: Direct ANSI halfblock output (no canvas, no encoder)
console.log('=== Test 1: Direct ANSI half-blocks ===');
const colors = ['31', '32', '33', '34', '35', '36'];
for (let row = 0; row < 4; row++) {
  let line = '';
  for (let col = 0; col < 40; col++) {
    const ci = (row + col) % colors.length;
    line += `\x1b[${colors[ci]}m\u2588`;
  }
  line += '\x1b[0m';
  console.log(line);
}
console.log('');

// Test 2: Direct truecolor ANSI half-blocks
console.log('=== Test 2: Truecolor half-blocks ===');
for (let row = 0; row < 4; row++) {
  let line = '';
  for (let col = 0; col < 40; col++) {
    const r = Math.floor((col / 40) * 255);
    const g = Math.floor((row / 4) * 255);
    const b = 128;
    line += `\x1b[38;2;${r};${g};${b}m\u2580`;
  }
  line += '\x1b[0m';
  console.log(line);
}
console.log('');

// Test 3: Canvas -> Buffer -> HalfBlock encoder
console.log('=== Test 3: Canvas + HalfBlock encoder ===');
const testW = 40;
const testH = 8; // 4 terminal rows
const canvas = new CanvasRenderer(testW, testH);
canvas.clear();

// Draw some colored rectangles
canvas.fillRect(0, 0, 10, 8, '#FF0000');   // Red
canvas.fillRect(10, 0, 10, 8, '#00FF00');  // Green
canvas.fillRect(20, 0, 10, 8, '#0000FF');  // Blue
canvas.fillRect(30, 0, 10, 8, '#FFFF00');  // Yellow

const buf = canvas.getBuffer();
console.log(`Buffer size: ${buf.length} bytes (expected: ${testW * testH * 4})`);

// Check buffer isn't all zeros
let nonZero = 0;
for (let i = 0; i < buf.length; i++) {
  if (buf[i] !== 0) nonZero++;
}
console.log(`Non-zero bytes in buffer: ${nonZero} / ${buf.length}`);

// Sample some pixels
for (let x = 0; x < 40; x += 5) {
  const idx = x * 4;
  console.log(`  Pixel (${x},0): R=${buf[idx]} G=${buf[idx+1]} B=${buf[idx+2]} A=${buf[idx+3]}`);
}

const hb = new HalfBlockEncoder();
const encoded = hb.encode(buf, testW, testH);
console.log(`Encoded length: ${encoded.length} chars`);

// Write the encoded output
process.stdout.write(encoded + '\n');
console.log('\x1b[0m');

// Test 4: Full-size canvas test
console.log('=== Test 4: Full canvas render ===');
const fullCanvas = new CanvasRenderer(size.width, size.height);
fullCanvas.clear();

// Draw a grid of colored blocks
const blockW = Math.floor(size.width / 10);
const blockH = Math.floor(size.height / 6);
const testColors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
                    '#FF8800', '#88FF00', '#0088FF', '#FF0088'];

for (let i = 0; i < 10; i++) {
  const x = i * blockW;
  for (let j = 0; j < 6; j++) {
    const y = j * blockH;
    fullCanvas.fillRect(x, y, blockW - 1, blockH - 1, testColors[(i + j) % testColors.length]);
  }
}

const fullBuf = fullCanvas.getBuffer();
let fullNonZero = 0;
for (let i = 0; i < fullBuf.length; i++) {
  if (fullBuf[i] !== 0) fullNonZero++;
}
console.log(`Full buffer: ${fullBuf.length} bytes, non-zero: ${fullNonZero}`);

if (proto === 'kitty') {
  console.log('Kitty encoder output (first 200 chars):');
  const ke = new KittyEncoder();
  const kittyOut = ke.encode(fullBuf, size.width, size.height);
  console.log(kittyOut.substring(0, 200).replace(/\x1b/g, '<ESC>'));
} else {
  const hbFull = new HalfBlockEncoder();
  const fullEncoded = hbFull.encode(fullBuf, size.width, size.height);
  console.log(`Full HB encoded length: ${fullEncoded.length}`);
  // Write first few lines
  const lines = fullEncoded.split(/\x1b\[\d+;\d*H/).slice(0, 5);
  console.log(`First escape sequences: ${lines.length}`);
}
