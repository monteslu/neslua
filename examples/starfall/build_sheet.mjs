// build_sheet.mjs - author the starfall sprite sheet with EXACT NES sub-palette
// index control, then emit both the source PNG (for the repo / asset pipeline)
// and the raw CHR (what the cart links). Each actor is a 16x16 (2x2 cell) block;
// digits 1/2/3 are indices into that actor's runtime sprite sub-palette, 0 is
// transparent. Authoring the indices directly (instead of quantizing arbitrary
// colors) keeps every tile of a 2x2 actor agreeing on which color is which -
// the thing a first-seen-order PNG quantizer can't guarantee.
//
//   node examples/starfall/build_sheet.mjs
//
// Layout on the 64x16 sheet (8 cols x 2 rows of 8x8 cells):
//   cells 0,1 / 8,9   = ship    (uses nes.spal 1)
//   cells 2,3 / 10,11 = invader (uses nes.spal 0)
//   cells 4,5 / 12,13 = burst   (uses nes.spal 3)
//   cells 6,7 / 14,15 = shot    (uses nes.spal 2)

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { NES_MASTER } from "../../compiler/nes_palette.js";

// each actor: [subPaletteColorForIndex1, index2, index3] as NES master indices,
// and a 16-row ASCII grid (16 wide) of digits 0..3.
const ship = {
  pal: [0x21, 0x30, 0x11],   // cyan body, white cockpit, dark-blue shade
  art: [
    "0000000000000000",
    "0000000110000000",
    "0000000110000000",
    "0000001111000000",
    "0000011111100000",
    "0000011221100000",
    "0000111221110000",
    "0001111221111000",
    "0011111221111100",
    "0111112112211110",
    "0111121111121110",
    "0113111111111310",
    "0130011111100310",
    "0000011011000000",
    "0000010000100000",
    "0000000000000000",
  ],
};
const invader = {
  pal: [0x16, 0x30, 0x27],   // red body, white eyes, orange accent
  art: [
    "0000000000000000",
    "0011000000001100",
    "0001100000011000",
    "0000111111110000",
    "0001111111111000",
    "0011111111111100",
    "0111122112211110",
    "0111122112211110",
    "0111111111111110",
    "0111133113311110",
    "0011113333111100",
    "0001111111111000",
    "0011011111101100",
    "0110000110000110",
    "0100000000000010",
    "0000000000000000",
  ],
};
const burst = {
  pal: [0x28, 0x17, 0x30],   // yellow, orange, white
  art: [
    "0000010000100000",
    "0100011001100010",
    "0010001221000100",
    "0001012332100100",
    "0000122333221000",
    "0011233333332100",
    "0012333333333210",
    "0123333113333310",
    "0123331111333210",
    "0012333333332100",
    "0011233333321100",
    "0001223332210000",
    "0010012332100100",
    "0100001221000010",
    "0010010000100100",
    "0000100000010000",
  ],
};
const shot = {
  pal: [0x2a, 0x3a, 0x30],   // green, light-green, white
  art: [
    "0000000000000000",
    "0000000110000000",
    "0000001221000000",
    "0000012332100000",
    "0000123223210000",
    "0001232112321000",
    "0012321001232100",
    "0123210000123210",
    "0123210000123210",
    "0012321001232100",
    "0001232112321000",
    "0000123223210000",
    "0000012332100000",
    "0000001221000000",
    "0000000110000000",
    "0000000000000000",
  ],
};

// sheet columns per actor 16x16 block, left to right
const actors = [ship, invader, burst, shot];

// a compact 8x8 bullet lives at tile 8 (row 0, col 8). Drawn at nes.spal(2)
// (green / light-green / white) it is a small bright bolt. A one-tile bullet
// keeps the sprite budget low: 6 bullets cost 6 tiles, not 24.
const bulletRow = [
  "00033000",
  "00033000",
  "00311300",
  "00311300",
  "00311300",
  "00311300",
  "00033000",
  "00033000",
];

// The sheet is 128px wide = 16 tiles per pattern-table row. neslua's spr(n,..,
// 2,2) composes a 2x2 actor as tiles n, n+1 (top) and n+16, n+17 (bottom) - the
// +16 stride is a FULL pattern-table row, so every actor must be a 2x2 block
// with its two halves 16 tiles apart. Placing each actor at columns ai*2 puts
// its top cells at n=ai*2 and its bottom cells at n+16 automatically.
//   ship n=0, invader n=2, burst n=4, shot n=6, star tile n=8.
const W = 128, H = 16;
// index grid (0..3) for the whole sheet
const grid = Array.from({ length: H }, () => new Array(W).fill(0));
actors.forEach((a, ai) => {
  const ox = ai * 16;   // 16 px = 2 tiles per actor, left to right
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++)
      grid[y][ox + x] = a.art[y].charCodeAt(x) - 48;
});
// bullet at tile 8 = row 0, col 8 -> pixels x 64..71, y 0..7
for (let y = 0; y < 8; y++)
  for (let x = 0; x < 8; x++)
    grid[y][64 + x] = bulletRow[y].charCodeAt(x) - 48;

// --- emit CHR: 8 cols x 2 rows of 8x8 cells, index = palette slot (0..3) ---
const cols = W / 8, rows = H / 8;
const chr = new Uint8Array(cols * rows * 16);
for (let ty = 0; ty < rows; ty++)
  for (let tx = 0; tx < cols; tx++) {
    const base = (ty * cols + tx) * 16;
    for (let y = 0; y < 8; y++) {
      let p0 = 0, p1 = 0;
      for (let x = 0; x < 8; x++) {
        const ci = grid[ty * 8 + y][tx * 8 + x] & 3;
        if (ci & 1) p0 |= 0x80 >> x;
        if (ci & 2) p1 |= 0x80 >> x;
      }
      chr[base + y] = p0;
      chr[base + 8 + y] = p1;
    }
  }
writeFileSync(new URL("./shmup_sheet.chr", import.meta.url), chr);

// --- emit PNG source (RGBA), colored with each actor's sub-palette ---
function nesRgb(idx) {
  const v = NES_MASTER[idx];
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const rgba = new Uint8Array(W * H * 4);
actors.forEach((a, ai) => {
  const ox = ai * 16;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const ci = a.art[y].charCodeAt(x) - 48;
      const p = (y * W + (ox + x)) * 4;
      if (ci === 0) { rgba[p + 3] = 0; continue; }
      const [r, g, b] = nesRgb(a.pal[ci - 1]);
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255;
    }
});
// the bullet, colored with the shot sub-palette (green=1, white=3)
{
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const ci = bulletRow[y].charCodeAt(x) - 48;
      if (ci === 0) continue;
      const [r, g, b] = nesRgb(shot.pal[ci - 1]);
      const p = (y * W + (64 + x)) * 4;
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = 255;
    }
}

// minimal PNG writer (RGBA, no filter)
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;   // filter type 0
  Buffer.from(rgba.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw)),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync(new URL("./shmup_sheet.png", import.meta.url), png);
console.log("wrote shmup_sheet.png (64x16) and shmup_sheet.chr (16 tiles, 256 bytes)");
console.log("palettes: SPR0 invader", invader.pal.map(h), "SPR1 ship", ship.pal.map(h), "SPR2 shot", shot.pal.map(h), "SPR3 burst", burst.pal.map(h));
function h(v){return "0x"+v.toString(16).padStart(2,"0");}
