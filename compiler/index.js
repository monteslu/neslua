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

export function compile(source, file = "main.lua", opts = {}) {
  return core(source, file, {
    target: "nes",
    sdkName: "neslua",
    memberNs: "nes",
    builtins: BUILTINS,
    members: GT_MEMBERS,
    callbacks: CALLBACKS,
    p8Palette: P8_PALETTE,
    nearestColorByte,
    limits: NES_LIMITS,
    ...opts,
  });
}

export { formatDiagnostics };
