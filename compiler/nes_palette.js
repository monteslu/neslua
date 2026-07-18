// nes_palette.js - the NES master palette + the P8->NES nearest-index bake.
//
// The NES color space is a fixed 64-entry hardware table (index 0-$3F, ~54
// visually distinct). neslua colors are NES palette indices; a STATIC P8 color
// literal 0-15 is baked to its nearest NES index at COMPILE time (the same
// design as gtlua's P8->CAPTURE bake, via luacretro's colorBake seam).
//
// This is a design convenience only: the RUNTIME palette is a fixed set of BG
// sub-palettes (see sdk/nes_api.c default_palette), so a baked index is the
// hardware color the loaded palette must actually contain to display. The bake
// gives "cls(1) is a dark blue" a sensible default without the game author
// hand-picking NES indices. docs/DIFFERENCES.md states the palette reality.

// NES hardware master palette (index -> #RRGGBB), from the platform master.
export const NES_MASTER = [
  0x000000, 0x7C7C7C, 0x0000FC, 0x0000BC, 0x4428BC, 0x940084, 0xA80020, 0xA81000,
  0x881400, 0x503000, 0x007800, 0x006800, 0x005800, 0x004058, 0x000000, 0x000000,
  0xBCBCBC, 0x0078F8, 0x0058F8, 0x6844FC, 0xD800CC, 0xE40058, 0xF83800, 0xE45C10,
  0xAC7C00, 0x00B800, 0x00A800, 0x00A844, 0x008888, 0x000000, 0x000000, 0x000000,
  0xF8F8F8, 0x3CBCFC, 0x6888FC, 0x9878F8, 0xF878F8, 0xF85898, 0xF87858, 0xFCA044,
  0xF8B800, 0xB8F818, 0x58D854, 0x58F898, 0x00E8D8, 0x000000, 0x000000, 0x000000,
  0xFCFCFC, 0xA4E4FC, 0xB8B8F8, 0xD8B8F8, 0xF8B8F8, 0xF8A4C0, 0xF0D0B0, 0xFCE0A8,
  0xF8D878, 0xD8F878, 0xB8F8B8, 0xB8F8D8, 0x00FCFC, 0x000000, 0x000000, 0x000000,
];

// The PICO-8 16-color reference palette (#RRGGBB).
const P8_RGB = [
  0x000000, 0x1D2B53, 0x7E2553, 0x008751, 0xAB5236, 0x5F574F, 0xC2C3C7, 0xFFF1E8,
  0xFF004D, 0xFFA300, 0xFFEC27, 0x00E436, 0x29ADFF, 0x83769C, 0xFF77A8, 0xFFCCAA,
];

// redmean color distance (the standard low-cost perceptual metric).
function dist(a, b) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const rm = (ar + br) / 2;
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  const wr = rm < 128 ? 2 : 3;
  const wb = rm < 128 ? 3 : 2;
  return wr * dr * dr + 4 * dg * dg + wb * db * db;
}

// Nearest NES index for an arbitrary RGB (used by the P8 bake). The unused
// $x_D/$x_E/$x_F slots (mirrored to black here) are skipped so a real color
// never snaps to a duplicate-black slot.
export function nearestNesIndex(rgb) {
  let best = 0x0F, bestD = Infinity;
  for (let i = 0; i < NES_MASTER.length; i++) {
    if ((i & 0x0F) >= 0x0D && i !== 0x0F) continue;   // skip the black mirrors
    const d = dist(rgb, NES_MASTER[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The baked P8 index -> NES index table. HAND-TUNED (the redmean nearest match
// alone snaps P8's muted dark colors onto NES's brighter saturated ramp - e.g.
// dark-blue reads closer to a dark brown by luminance - so the canonical 16 are
// pinned to the NES color that reads as the RIGHT color FAMILY, the same
// discipline as gtlua's P8->CAPTURE table). Index = NES hardware palette entry.
export const P8_PALETTE = [
  0x0F,  //  0 black      -> NES black backdrop
  0x02,  //  1 dark-blue  -> NES blue ($0000FC)  [hand: luminance snaps to brown]
  0x14,  //  2 dark-purple-> NES purple ($D800CC dimmed via mid palette at load)
  0x1A,  //  3 dark-green -> NES green ($00A800)
  0x17,  //  4 brown      -> NES $E45C10 (orange-brown)
  0x00,  //  5 dark-grey  -> NES $7C7C7C dark grey
  0x10,  //  6 light-grey -> NES $BCBCBC
  0x30,  //  7 white      -> NES $FCFCFC
  0x16,  //  8 red        -> NES $F83800
  0x27,  //  9 orange     -> NES $FCA044
  0x28,  // 10 yellow     -> NES $F8B800
  0x2A,  // 11 green      -> NES $58D854 (bright green)
  0x11,  // 12 blue       -> NES $0078F8 (sky blue)
  0x04,  // 13 lavender   -> NES $4428BC (indigo)
  0x25,  // 14 pink       -> NES $F85898
  0x36,  // 15 peach      -> NES $F0D0B0
];

// The luacretro colorBake seam wants a `nearestColorByte(r,g,b)` for the
// gt.rgb(r,g,b) escape hatch. NES has no direct-RGB color, so map an RGB triple
// to its nearest NES palette index.
export function nearestColorByte(r, g, b) {
  return nearestNesIndex(((r & 255) << 16) | ((g & 255) << 8) | (b & 255));
}
