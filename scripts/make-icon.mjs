// Draws the app icon (build/icon.png, 1024×1024) with plain Node — no image libraries needed.
// electron-builder derives the Windows .ico and macOS .icns from it. Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZE = 1024;
const px = new Uint8Array(SIZE * SIZE * 4);

const BG_TOP = [0x22, 0x26, 0x30];
const BG_BOTTOM = [0x14, 0x16, 0x1b];
const ACCENT = [0xff, 0x9f, 0x43];
const RING = [0x3a, 0x40, 0x50];

/** Coverage (0..1) of a pixel by a shape given its signed distance (negative = inside), 1 px antialiasing. */
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d));

function blend(i, color, alpha) {
  for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - alpha) + color[c] * alpha);
  px[i + 3] = Math.max(px[i + 3], Math.round(alpha * 255));
}

const margin = 64;
const radius = 200; // rounded-square corner radius
const cx = SIZE / 2;
const cy = SIZE / 2;
const discR = 300;
const ringW = 26;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // Rounded-square background with a vertical gradient.
    const qx = Math.max(Math.abs(x + 0.5 - cx) - (cx - margin - radius), 0);
    const qy = Math.max(Math.abs(y + 0.5 - cy) - (cy - margin - radius), 0);
    const bgD = Math.hypot(qx, qy) - radius;
    const t = y / SIZE;
    const bg = BG_TOP.map((v, c) => v + (BG_BOTTOM[c] - v) * t);
    blend(i, bg, cover(bgD));
    if (bgD > 0.5) continue;

    // The ◐ mark: a ring with its left half filled in the accent colour.
    const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    blend(i, RING, cover(Math.abs(r - discR) - ringW / 2));
    // Left half of the outer disc in one pass, so no seam shows where the ring meets the fill.
    blend(i, ACCENT, cover(Math.max(r - (discR + ringW / 2), x + 0.5 - cx)));
  }
}

// Minimal PNG encoder (RGBA, no filtering).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
writeFileSync(new URL('../build/icon.png', import.meta.url), png);
console.log(`build/icon.png written (${(png.length / 1024).toFixed(0)} KB)`);
