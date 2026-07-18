# neslua

[![npm version](https://img.shields.io/npm/v/neslua.svg)](https://www.npmjs.com/package/neslua)

**PICO-8-flavored Lua, ahead-of-time compiled to a real NES `.nes` ROM.** No
interpreter, no VM: your Lua becomes native 6502 machine code. Zero native tools,
either - the cc65 toolchain runs as bundled WebAssembly. neslua is the NES member
of the [luacretro](https://github.com/monteslu) console SDK family (GameTank, GBA,
Genesis, NES, C64), sharing one statically-typed Lua-to-C front-end.

<p align="center">
  <img src="https://raw.githubusercontent.com/monteslu/neslua/main/examples/starfall/screenshot.png" width="480" alt="starfall: a complete NES shmup - a staggered formation of red invaders, a cyan player ship firing a green bolt, over a starfield with a score/lives HUD">
</p>

That is [`examples/starfall`](examples/starfall) - a complete shmup in ~200
lines of Lua: a staggered invader formation (all 12 on-screen within the NES's
8-sprites-per-scanline limit), a ship you fly and fire, collisions, score/lives,
and a background-tile starfield. Build and play it:

```sh
npx neslua run examples/starfall/main.lua --sheet examples/starfall/shmup_sheet.chr
```

## Your first game

A complete NES game - one `main.lua`: a hardware sprite you move with the
d-pad, plus a greeting. Here's the core loop; `examples/hello/main.lua` builds
on it with a whole swarm of bouncing sprites (the screenshot below).
`_update60` runs the movement 60 times a second; `_draw` redraws the sprite
every frame:

```lua
local ready = 0
local x = 120
local y = 112

function _update60()               -- 60fps input + movement
  if (btn(1)) then x += 2 end      -- right
  if (btn(0)) then x -= 2 end      -- left
  if (btn(3)) then y += 2 end      -- down
  if (btn(2)) then y -= 2 end      -- up
  x = mid(8, x, 240)               -- clamp to the visible playfield
  y = mid(16, y, 208)
end

function _draw()
  if (ready == 0) then             -- static backdrop + greeting: draw once
    cls(12)                        -- sky-blue backdrop
    print("hello neslua", 72, 32, 7)
    ready = 1
  end
  spr(1, x, y)                     -- the hardware sprite, redrawn every frame
end
```

> The NES is a tile+sprite machine. The square is a real hardware sprite -
> `spr(1, x, y)` pushes the built-in solid-block tile into shadow OAM, DMA'd to
> the PPU every frame, so it moves freely and costs nothing to redraw. The
> greeting is background tiles written through a queue that drains ~16
> tiles/frame, so we lay it down once (the guard) and never repaint it. That
> split - cheap sprites, static background - is how the NES actually animates.
> See [docs/DIFFERENCES.md](docs/DIFFERENCES.md).

Build it and play it in a window:

```sh
npx neslua run examples/hello/main.lua
```

<p align="center">
  <img src="https://raw.githubusercontent.com/monteslu/neslua/main/examples/hello/screenshot.png" width="480" alt="hello neslua: a player block and a swarm of bouncing ball and diamond hardware sprites under 'hello neslua' text on a sky-blue NES screen">
</p>

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
- [`hello`](examples/hello) - a smiley + centered text (the family hello).
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
