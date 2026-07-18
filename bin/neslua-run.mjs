// neslua-run.mjs - play a .nes in a window via the shared romdev SDL host.
//
// Thin shim over romdev-core-runner (the one SDL host in the ecosystem). It
// loads the bundled fceumm core (straight-through NES pad) and maps the
// keyboard: arrows = d-pad, X = A, Z = B, Enter = START, RShift = SELECT.
// If @kmamal/sdl isn't installed the runner throws { code:"SDL_UNAVAILABLE" };
// we re-throw so the CLI can tell the user to load the .nes in any emulator.

import { runRom as runRomInWindow } from "romdev-core-runner";
import * as core from "romdev-core-fceumm";

// Keyboard -> libretro RetroPad bit (see romdev-core-runner bitToName).
const keyMap = { up: 4, down: 5, left: 6, right: 7, x: 8, z: 0, return: 3, rshift: 2 };
// Gamepad: bottom = A, right = B, matching the keys.
const buttonMap = { dpadUp: 4, dpadDown: 5, dpadLeft: 6, dpadRight: 7, a: 8, b: 0, back: 2, guide: 2, start: 3 };

export async function runRom(romPath, opts = {}) {
  const session = await runRomInWindow(romPath, { core, keyMap, buttonMap, scale: 3, ...opts });
  await session.closed;
}
