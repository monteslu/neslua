#!/usr/bin/env node
// chr-encode.mjs - PNG sprite sheet -> raw NES CHR (pattern-table) blob.
//
//   node compiler/chr-encode.mjs sheet.png -o sheet.chr
//
// Each 8x8 tile becomes 16 bytes: two 1-bit planes (2 bits/pixel). The tile's
// pixels are mapped to a 4-entry sub-palette by nearest NES master color; a tile
// that needs more than 4 distinct colors is quantized to the 4 most-used and a
// warning is reported (the family's "digested verdict" discipline).
//
// A 128x128 PNG = 256 8x8 tiles = exactly one NES pattern table (the PICO-8
// sheet convention maps perfectly).

import { decodePng } from "./png-decode.mjs";
import { NES_MASTER, nearestNesIndex } from "./nes_palette.js";

function nesIndexOfRgba(r, g, b, a) {
  if (a < 128) return -1;   // transparent -> color 0
  return nearestNesIndex((r << 16) | (g << 8) | b);
}

export function pngToChr(pngBytes) {
  const { width, height, rgba } = decodePng(pngBytes);
  if (width % 8 || height % 8) throw new Error(`sheet must be a multiple of 8x8 (got ${width}x${height})`);
  const cols = width / 8, rows = height / 8;
  const tiles = cols * rows;
  const chr = new Uint8Array(tiles * 16);
  const warnings = [];

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      // gather the tile's NES indices + build a per-tile palette (max 3 + clear)
      const pal = [];                 // NES indices, [0] reserved for transparent
      const px = new Array(64);
      let ci = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const p = ((ty * 8 + y) * width + (tx * 8 + x)) * 4;
          const idx = nesIndexOfRgba(rgba[p], rgba[p + 1], rgba[p + 2], rgba[p + 3]);
          px[y * 8 + x] = idx;
          if (idx >= 0 && !pal.includes(idx)) pal.push(idx);
        }
      }
      if (pal.length > 3) {
        warnings.push(`tile (${tx},${ty}) used ${pal.length} colors; kept the first 3`);
        pal.length = 3;
      }
      // emit two planes; color = index-in-palette+1 (0 = transparent)
      const base = (ty * cols + tx) * 16;
      for (let y = 0; y < 8; y++) {
        let p0 = 0, p1 = 0;
        for (let x = 0; x < 8; x++) {
          const idx = px[y * 8 + x];
          let ci2 = 0;
          if (idx >= 0) { const k = pal.indexOf(idx); ci2 = k < 0 ? 0 : k + 1; }
          if (ci2 & 1) p0 |= 0x80 >> x;
          if (ci2 & 2) p1 |= 0x80 >> x;
        }
        chr[base + y] = p0;
        chr[base + 8 + y] = p1;
      }
    }
  }
  return { chr, tiles, cols, rows, warnings };
}

// CLI. Everything node-only lives INSIDE this guard - `process` and node:fs
// are both absent in a browser, and a top-level reference to either throws on
// import. The IDEs import pngToChr() straight from this module, so the module
// body must stay environment-agnostic.
// Node's require, reached without a static `node:fs` import and without a
// top-level `await import` (which would make this module async and get it
// rejected by bundlers targeting the browser).
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync, writeFileSync } = process.getBuiltinModule("fs");
  const args = process.argv.slice(2);
  const oIdx = args.indexOf("-o");
  const out = oIdx !== -1 ? args[oIdx + 1] : null;
  const input = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-o");
  if (!input || !out) {
    console.error("usage: node compiler/chr-encode.mjs sheet.png -o sheet.chr");
    process.exit(2);
  }
  const { chr, tiles, warnings } = pngToChr(readFileSync(input));
  writeFileSync(out, chr);
  for (const w of warnings) console.error("warning: " + w);
  console.log(`wrote ${out}: ${tiles} tiles (${chr.length} bytes)`);
}

void NES_MASTER;   // (kept exported for tooling; referenced by nes_palette)
