// builtins.js - the neslua PICO-8 API surface for the NES.
//
// The C symbol names use the shared lc_* schema; luacretro's cName final pass
// collapses lc_* to nes_* for this target (so lc_cls -> nes_cls).
//
// The NES has NO framebuffer, so the surface model differs from the framebuffer
// SDKs (see docs/DIFFERENCES.md):
//   - background: map/print/tset/tpal write nametable TILES via the VRAM queue
//   - sprites:    spr() -> the 64-entry shadow OAM
//   - pixel canvas: pset/line/rect/rectfill/circ/circfill paint a small
//                   CHR-RAM window (nes.canvas(cw,ch) reserves it)
//   - blank mode: nes.blank(true) forces rendering off for the full verb set
//
// Param kinds: coord (C int, fixed floored), num (16.16 long), int, color (a
// baked NES palette index), flip (truthy -> packed bit).

export const BUILTINS = {
  // ---- background surface ---------------------------------------------------
  cls:      { params: [["color", true]], ret: "void", c: "lc_cls" },
  camera:   { params: [["coord", true], ["coord", true]], ret: "void", c: "lc_camera" },
  color:    { params: [["color", false]], ret: "void", c: "lc_color" },
  // print(v [,x,y] [,c]): baked 1bpp font -> nametable tiles (32x28 text cells).
  print:    { params: [], ret: "int", special: "print" },
  // map(cx,cy,sx,sy,cw,ch): stamp tiles from the imported __map__ (128 wide).
  map:      { params: [["int", true], ["int", true], ["coord", true], ["coord", true], ["int", true], ["int", true]], ret: "void", special: "map" },
  mget:     { params: [["int", false], ["int", false]], ret: "int", special: "mget" },

  // ---- sprite surface -------------------------------------------------------
  // spr(n,x,y,[w,h,fx,fy]): 8x8 sprite tiles onto the shadow OAM. w/h = cells.
  spr:      { params: [["int", false], ["coord", false], ["coord", false], ["int", true], ["int", true], ["flip", true], ["flip", true]], ret: "void", c: "lc_spr" },

  // ---- pixel canvas (surface 3) ---------------------------------------------
  // These paint the active pixel canvas (nes.canvas) or, inside nes.blank, the
  // whole background. On a bare cart with no canvas they no-op (documented).
  pset:     { params: [["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_pset" },
  pget:     { params: [["coord", false], ["coord", false]], ret: "int", c: "lc_pget" },
  sset:     { params: [["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_sset" },
  rect:     { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_rect" },
  rectfill: { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_rectfill" },
  circ:     { params: [["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_circ" },
  circfill: { params: [["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_circfill" },
  line:     { params: [["coord", false], ["coord", false], ["coord", false], ["coord", false], ["color", true]], ret: "void", c: "lc_line" },

  // ---- input ----------------------------------------------------------------
  // 0=left 1=right 2=up 3=down 4=O(NES B) 5=X(NES A) 6=select 7=start
  btn:      { params: [["int", false], ["int", true]], ret: "bool", c: "lc_btn" },
  btnp:     { params: [["int", false], ["int", true]], ret: "bool", c: "lc_btnp" },

  // ---- sound (APU; sfx v1) --------------------------------------------------
  sfx:      { params: [["int", false], ["int", true]], ret: "void", c: "lc_sfx", audio: true },

  // ---- math -----------------------------------------------------------------
  flr:   { params: [["num", false]], ret: "int", c: null, special: "flr" },
  ceil:  { params: [["num", false]], ret: "int", c: null, special: "ceil" },
  abs:   { params: [["num", false]], ret: "same", c: null, special: "abs" },
  sgn:   { params: [["num", false]], ret: "int", c: null, special: "sgn" },
  min:   { params: [["num", false], ["num", true]], ret: "same", c: null, special: "min" },
  max:   { params: [["num", false], ["num", true]], ret: "same", c: null, special: "max" },
  mid:   { params: [["num", false], ["num", false], ["num", false]], ret: "same", c: null, special: "mid" },
  sqrt:  { params: [["num", false]], ret: "fixed", c: "lc_fsqrt" },
  sin:   { params: [["num", false]], ret: "fixed", c: "lc_fsin" },
  cos:   { params: [["num", false]], ret: "fixed", c: "lc_fcos" },
  atan2: { params: [["num", false], ["num", false]], ret: "fixed", c: "lc_fatan2" },

  band:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "&" },
  bor:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "|" },
  bxor:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "^^" },
  bnot:  { params: [["num", false]], ret: "same", c: null, special: "bitop", op: "~" },
  shl:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: "<<" },
  shr:   { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: ">>" },
  lshr:  { params: [["num", false], ["num", false]], ret: "same", c: null, special: "bitop", op: ">>>" },
  rnd:   { params: [["num", true]], ret: "fixed", c: "lc_rnd" },
  srand: { params: [["num", false]], ret: "void", c: "lc_srand" },
  t:     { params: [], ret: "fixed", c: "lc_time" },
  time:  { params: [], ret: "fixed", c: "lc_time" },

  // fixed-capacity static allocations (land in the 8KB PRG-RAM at $6000).
  array:  { params: [["int", false], ["num", true]], ret: "array", special: "array" },
  array8: { params: [["int", false], ["num", true]], ret: "array", special: "array" },
  pool:   { params: [["int", false]], ret: "pool", special: "pool" },
  add:    { params: [], ret: "void", special: "add" },
  del:    { params: [], ret: "void", special: "del" },
};

// nes.* extras: the NES-specific surface controls.
export const GT_MEMBERS = {
  // nes.rgb(byte) / nes.rgb(r,g,b): a raw NES palette index (0-63), or the
  // nearest index for an RGB triple resolved at compile time.
  rgb:     { kind: "fn", params: [["int", false]], ret: "int", special: "rgb" },
  // reserve/place the pixel canvas (a CHR-RAM window; cap 32 tiles).
  canvas:  { kind: "fn", params: [["int", false], ["int", false]], ret: "void", c: "lc_canvas" },
  canvas_at: { kind: "fn", params: [["int", false], ["int", false], ["int", false], ["int", false]], ret: "void", c: "lc_canvas_at" },
  canvas_clear: { kind: "fn", params: [], ret: "void", c: "lc_canvas_clear" },
  canvas_show:  { kind: "fn", params: [], ret: "void", c: "lc_canvas_show" },
  // blank-mode escape hatch: force rendering off for the full drawing verb set.
  blank:   { kind: "fn", params: [["flip", false]], ret: "void", c: "lc_blank" },
  // write a single nametable tile / attribute (16x16) palette.
  tset:    { kind: "fn", params: [["int", false], ["int", false], ["int", false]], ret: "void", c: "lc_tset" },
  tpal:    { kind: "fn", params: [["int", false], ["int", false], ["int", false]], ret: "void", c: "lc_tpal" },
  // OAM rotation so >8-per-scanline crowds shimmer instead of vanish.
  flicker: { kind: "fn", params: [["flip", false]], ret: "void", c: "lc_flicker" },
  // select the sprite sub-palette (0-3) that subsequent spr() calls use.
  spal:    { kind: "fn", params: [["int", false]], ret: "void", c: "lc_spal" },
  // backdrop / overscan color, and frames-since-boot.
  border:  { kind: "fn", params: [["color", false]], ret: "void", c: "lc_border" },
  ticks:   { kind: "fn", params: [], ret: "int", c: "nes_ticks", isValue: false },
};

// P8 color index 0-15 -> NES master palette index, computed in nes_palette.js.
export { P8_PALETTE } from "./nes_palette.js";

export const CALLBACKS = ["_init", "_update", "_update60", "_draw"];
