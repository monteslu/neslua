// neslua compiler entry - binds neslua's identity + builtins to the shared
// luacretro front-end. (The compiler itself lives in the luacretro package;
// this SDK owns the NES builtins + runtime + build pipeline.)

import { compile as core, formatDiagnostics } from "luacretro";
import { BUILTINS, GT_MEMBERS, CALLBACKS, P8_PALETTE } from "./builtins.js";
import { nearestColorByte } from "./nes_palette.js";

// NES static-allocation ceiling: arrays + pools land in the 8KB PRG-RAM at
// $6000. Cap array capacity well under that (int elements are 2 bytes; leave
// room for BSS + several arrays). Pools stay at the family's 64.
const NES_LIMITS = { arrayMax: 2048, poolMax: 64 };

// The NES target descriptor (cc65 / MMC1). A tile+sprite machine: framebuffer
// false, so the SDK enables only the draw verbs its three-surface runtime can
// honor. 6502 zero-page fastcall; cc65 C89 needs the odd-frame decl first;
// _update runs at 30fps. luacretro knows none of these names.
const TARGET = {
  caps: {
    zpFastcall: true, zpUserFn: true, fixedZp: true,
    banked: false, nativeDiv: false, colorBake: true, framebuffer: false,
    prefix: "nes", finalRename: true,
  },
  harness: {
    signature: "void main(void)",
    init: ["nes_init"],
    onAudio: "nes_audio_init", onMusic: null, onFps30: null,
    loopTop: ["nes_update_inputs", "nes_oam_clear"], frameEnd: "nes_endframe",
    fps30Style: "oddCounter", oddVar: "_nes_odd", oddDeclFirst: true,
    returns: false, includes: ["nes_api.h", "nes_math.h"],
  },
};

export function compile(source, file = "main.lua", opts = {}) {
  return core(source, file, {
    sdkName: "neslua",
    memberNs: "nes",
    builtins: BUILTINS,
    members: GT_MEMBERS,
    callbacks: CALLBACKS,
    p8Palette: P8_PALETTE,
    nearestColorByte,
    limits: NES_LIMITS,
    ...opts,
    target: TARGET,   // the SDK OWNS its target - not overridable by callers
  });
}

export { formatDiagnostics };
