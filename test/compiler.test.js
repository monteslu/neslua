// compiler.test.js - the neslua compiler seam: dialect, the NES codegen schema,
// color bake, the nes.* namespace, and the family refusals.
import { test } from "node:test";
import assert from "node:assert";
import { compile } from "../compiler/index.js";

function ok(src) {
  const r = compile(src, "t.lua", {});
  assert.ok(r.ok, "expected compile OK:\n" + (r.diagnostics || []).map((d) => d.message).join("\n"));
  return r.c;
}
function errs(src) {
  const r = compile(src, "t.lua", {});
  return (r.diagnostics || []).filter((d) => d.severity === "error").map((d) => d.message);
}

test("emits the nes_ runtime schema (not gt_)", () => {
  const c = ok(`function _draw() cls(1) end`);
  assert.match(c, /#include "nes_api.h"/);
  assert.match(c, /#include "nes_math.h"/);
  assert.match(c, /nes_cls\(/);
  assert.doesNotMatch(c, /\bgt_/, "no gt_ symbols should leak into NES codegen");
});

test("color bake: a static P8 index bakes to a NES palette index", () => {
  const c = ok(`function _draw() cls(1) end`);
  // P8 index 1 (dark blue) -> NES $02, so cls(1) -> nes_cls(2)
  assert.match(c, /nes_cls\(2\)/);
});

test("btn inline uses the packed family masks the runtime agrees with", () => {
  const c = ok(`function _update() if btn(1) then end end\nfunction _draw() end`);
  // btn(1) (right) inlines to the shared BTN_MASKS[1] = 256
  assert.match(c, /nes_pad0 & 256u/);
});

test("the NES harness stages sprites then waits (loop-order baked in)", () => {
  const c = ok(`function _draw() spr(1,0,0) end`);
  assert.match(c, /nes_oam_clear\(\);/);
  assert.match(c, /nes_endframe\(\);/);
  // oam_clear must precede the draw callback, endframe after (stage-then-wait)
  const iClear = c.indexOf("nes_oam_clear();");
  const iDraw = c.indexOf("lcl__draw();");
  const iEnd = c.indexOf("nes_endframe();");
  assert.ok(iClear < iDraw && iDraw < iEnd, "order: oam_clear -> _draw -> endframe");
});

test("30fps update runs every other frame (C89 decl-before-stmt)", () => {
  const c = ok(`function _update() end\nfunction _draw() end`);
  // the odd-frame counter is declared BEFORE nes_init() (cc65 is C89)
  const iOdd = c.indexOf("_nes_odd = 0");
  const iInit = c.indexOf("nes_init();");
  assert.ok(iOdd >= 0 && iOdd < iInit, "the odd counter declares before nes_init()");
});

test("nes.* namespace resolves (canvas, blank, tset, border)", () => {
  ok(`function _init() nes.canvas(4,4) nes.blank(false) nes.tset(1,1,2) nes.border(3) end\n` +
     `function _update() end\nfunction _draw() end`);
});

test("gt.* is refused on the NES (wrong namespace - nes.* is the one)", () => {
  // 'gt' is not the NES extras namespace, so gt.border() is not a valid call.
  const e = errs(`function _draw() gt.border(1) end`);
  assert.ok(e.length > 0, "gt.* must not compile on the NES");
});

test("no implicit globals - diagnostic names the SDK", () => {
  const e = errs(`function _update() y = 5 end\nfunction _draw() end`);
  assert.ok(e.some((m) => /neslua has no implicit globals/.test(m)), e.join("; "));
});

test("conditions must be boolean (the P8-truthy wall)", () => {
  const e = errs(`local n=0\nfunction _update() if n then end end\nfunction _draw() end`);
  assert.ok(e.some((m) => /conditions must be boolean/.test(m)), e.join("; "));
});

test("array capacity is bounded by the NES PRG-RAM limit", () => {
  // NES cap is 2048 (nes index.js NES_LIMITS.arrayMax)
  const e = errs(`local a=array(4000)\nfunction _update() end\nfunction _draw() end`);
  assert.ok(e.some((m) => /between 1 and 2048/.test(m)), e.join("; "));
});

test("fixed-point semantics: pow-of-two divide folds to a shift", () => {
  const c = ok(`local x=0.0\nfunction _update() x=x/2 end\nfunction _draw() end`);
  assert.match(c, />> 1/);   // /2 -> >>1 on the 16.16 value
});

test("the PICO-8 callback contract is required", () => {
  const e = errs(`local x=0`);
  assert.ok(e.some((m) => /_update|_draw|callback contract/.test(m)), e.join("; "));
});
