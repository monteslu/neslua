# neslua

[![npm version](https://img.shields.io/npm/v/neslua.svg)](https://www.npmjs.com/package/neslua)

**PICO-8-flavored Lua, ahead-of-time compiled to a real NES `.nes` ROM.** No
interpreter, no VM: your Lua becomes native 6502 machine code. Zero native tools,
either - the cc65 toolchain runs as bundled WebAssembly. neslua is the NES member
of the [luacretro](https://github.com/monteslu) console SDK family (GameTank, GBA,
Genesis, NES, C64), sharing one statically-typed Lua-to-C front-end.

## Your first game

The whole hello, one `main.lua`: a greeting plus a hardware sprite you move with
the d-pad. `_update60` runs the movement 60 times a second; `_draw` redraws the
sprite every frame (`examples/hello/main.lua`):

```lua
local ready = 0
local x = 120
local y = 120

function _update60()             -- 60fps: read the d-pad, move the sprite
  if (btn(1)) then x += 2 end    -- right
  if (btn(0)) then x -= 2 end    -- left
  if (btn(3)) then y += 2 end    -- down
  if (btn(2)) then y -= 2 end    -- up
  x = mid(8, x, 240)             -- keep it on the visible screen
  y = mid(16, y, 208)
end

function _draw()
  if (ready == 0) then           -- background tiles: draw the greeting once
    cls(12)                      -- sky-blue backdrop
    print("hello neslua", 72, 96, 7)
    ready = 1
  end
  spr(1, x, y)                   -- one hardware sprite, redrawn every frame
end
```

> **Why the greeting is drawn once.** The moving thing is a real hardware
> sprite: `spr(1, x, y)` pushes a tile into shadow OAM, DMA'd to the PPU every
> frame, so it costs nothing to redraw and moves freely. The greeting is
> *background* tiles, written through a queue that drains only ~16 tiles/frame -
> so you write it once (the `ready` guard) and never repaint it. Cheap sprites
> over a static background is how the NES animates - not a full-screen repaint.
> See [docs/DIFFERENCES.md](docs/DIFFERENCES.md).

Build it and play it in a window:

```sh
npx neslua run examples/hello/main.lua
```

<p align="center">
  <img src="https://raw.githubusercontent.com/monteslu/neslua/main/examples/hello/screenshot.png" width="480" alt="hello neslua: a red hardware sprite below the greeting on a sky-blue NES screen">
</p>

## Featured example: a full shmup

<p align="center">
  <img src="https://raw.githubusercontent.com/monteslu/neslua/main/examples/starfall/screenshot.png" width="480" alt="starfall: a complete NES shmup - a staggered formation of red invaders, a cyan player ship firing a green bolt, over a starfield with a score/lives HUD">
</p>

[`examples/starfall`](examples/starfall) is a complete shmup in ~200 lines of
Lua: a staggered invader formation (all 12 on-screen within the NES's
8-sprites-per-scanline limit), a ship you fly and fire, collisions, score/lives,
and a background-tile starfield. Sprite art is imported from a PNG. Build and
play it:

```sh
npx neslua run examples/starfall/main.lua --sheet examples/starfall/shmup_sheet.chr
```

Or build the cartridge - a byte-for-byte `.nes` that runs on any emulator or real
hardware:

```sh
npx neslua build examples/hello/main.lua -o hello.nes
```

That's the whole loop: write `main.lua`, `run` it, ship the `.nes`. (`npx neslua
c main.lua` prints the generated C, for debugging.)

## Why neslua

- **Real cartridges.** The output is a byte-for-byte `.nes` that runs on real
  hardware and every NES emulator - not a fantasy console.
- **The same Lua as the rest of the family.** PICO-8's 16.16 fixed-point number
  model, the `_init`/`_update`/`_draw` callback contract, the dialect
  (`+= -= *= /= \= %=`, `\` floor-division, `//` comments). Where the hardware
  has a wall, the compiler **fails loudly at compile time** with a fix-it.
- **Honest about the hardware.** The NES has no framebuffer, so neslua exposes
  three real surfaces (background tiles, sprites, a small pixel canvas) plus a
  blank-mode escape hatch - see [docs/DIFFERENCES.md](docs/DIFFERENCES.md). It
  does not pretend a 60fps full-screen `pset` canvas exists, because that is
  physically impossible on this machine.
- **8 KB of RAM for your game.** The standard cart is MMC1 with battery-backed
  PRG-RAM at `$6000`, so `array()`/`pool()` allocations have room (bare NROM
  leaves 512 bytes).

## The three-surface graphics model

| surface | verbs | what it is |
|---|---|---|
| **background** | `cls` `print` `map` `nes.tset` `nes.tpal` `nes.camera` | nametable tiles (32x28 text cells), written through the VRAM queue |
| **sprites** | `spr` | 8x8 hardware sprites (64 max, 8/scanline), staged in the shadow OAM |
| **pixel canvas** | `pset` `line` `rect` `rectfill` `circ` `circfill` | a small CHR-RAM window `nes.canvas(cw,ch)` the P8 drawing verbs paint |
| **blank mode** | *the full verb set* | `nes.blank(true)` - unlimited VRAM writes, screen dark (title cards) |

Resolution: the PPU renders **256 x 240**; NTSC output crops to **256 x 224**
visible. Coordinate space is 256 x 240. Full details in
[docs/DIFFERENCES.md](docs/DIFFERENCES.md).

## Examples

Each builds to a `.nes` and runs on the emulator (real captured frames below):

- [`starfall`](examples/starfall) - a complete shmup: staggered invaders, a
  ship that flies and fires, collisions, score/lives, a starfield (the hero
  image above). Shows the sprite-budget discipline the NES demands.
- [`hello`](examples/hello) - a greeting + a hardware sprite you move (the
  simplest idiomatic NES program).
- [`pad-square`](examples/pad-square) - move a sprite with the d-pad.
- [`mathcheck`](examples/mathcheck) - the 16.16 fixed-point conformance cart.
- [`canvas`](examples/canvas) - the pixel-canvas surface: a vector logo.

## Docs

- [CHEATSHEET.md](docs/CHEATSHEET.md) - the whole API on one page.
- [DIFFERENCES.md](docs/DIFFERENCES.md) - how the NES differs from PICO-8.
- [ASSETS.md](docs/ASSETS.md) - PNG -> CHR, tilemaps, color rules.

## Requirements

[Node.js](https://nodejs.org/) **24+**, and nothing else. `npm install` pulls in
`luacretro` (the shared front-end), `romdev-toolchain-cc65` (the cc65 toolchain
as WebAssembly), and `romdev-core-fceumm` (the emulator core for `neslua run`,
which also needs the optional `@kmamal/sdl` for the window). No native compiler
or emulator to install.

## License

MIT. No commercial game names in the shipped docs; the API is generic.
