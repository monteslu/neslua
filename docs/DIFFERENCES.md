# neslua - how the NES differs from PICO-8

neslua is PICO-8-flavored Lua compiled to a real NES cartridge. The language
(the fixed-point number model, the dialect, the callback contract) is the same
across the whole SDK family. What differs is the **hardware**, and the NES is
the family's most constrained target. This page is the honest accounting.

## Resolution (stated the same everywhere)

- The PPU renders **256 x 240**. Standard NTSC output crops 8px top + 8px
  bottom (overscan), so the **visible area is 256 x 224**.
- neslua's coordinate space is the hardware's **256 x 240**. Rows `y < 8` and
  `y >= 232` are in the overscan and may be clipped on real hardware/TVs.
- HUD guidance: keep text at tile **row 2 or below** (`y >= 16`) and bottom
  prompts at **row 27 or above** (`y <= 216`).
- Screenshots in this repo are pixel-perfect **integer-scaled** (2x = 512 x 448
  of the visible frame). Never resampled.

## The NES has no framebuffer (the core difference)

Every other SDK in the family draws into a full-screen pixel surface. The NES
does **not** have one - it is a tile + sprite machine, and VRAM is only writable
during vblank (a ~2270-cycle budget). So neslua exposes **three real surfaces**
plus one escape hatch, instead of pretending a full-screen `pset` canvas exists.

### 1. Background (tiles) - the primary "draw" target

`cls`, `print`, `map`, `nes.tset`, `nes.tpal`, `nes.camera` write **tiles** to
the nametable through a VRAM queue the NMI handler drains (~16 writes/vblank).

- `print()` renders a baked 1bpp font at tile granularity: **32 x 28** visible
  text cells. Coordinates are pixels; they snap to the 8x8 tile grid.
- `cls(c)` sets the backdrop color (palette entry `$3F00`). The full nametable
  clear happens at boot and in blank mode.
- **Budget reality:** the queue drains ~16 tile writes per frame. Re-drawing a
  full screen of text *every* frame saturates the queue - draw static content
  **once** (the examples set a `drawn`/`ready` flag). Changing content flows
  through fine at a few tiles per frame.

### 2. Sprites

`spr(n, x, y, [w, h, flipx, flipy])` pushes 8x8 sprite tiles onto the 64-entry
shadow OAM, DMA'd to the PPU every frame.

- **64 hardware sprites; 8 per scanline** (the 9th+ on a line are dropped).
- The generated frame loop stages sprites (`nes_oam_clear` then your `spr`
  calls) **before** waiting for vblank - the #1 NES sprite-flicker footgun is
  baked out of the loop so you can't write it wrong.
- A bare cart ships three default sprite tiles (1 = solid block, 2 = ball,
  3 = diamond). Import your own with the CHR encoder (see ASSETS.md).

### 3. Pixel canvas (the constrained P8 drawing surface)

`nes.canvas(cw, ch)` reserves a `cw x ch` **tile** window (cap 64 tiles) of
CHR-RAM mapped to a nametable region. The P8 drawing verbs
(`pset`/`pget`/`line`/`rect`/`rectfill`/`circ`/`circfill`/`sset`) paint into a
CPU-side buffer; dirty tiles upload a tile per frame.

- The canvas is **1bpp**: drawing color `!= 0` sets a pixel, color `0` clears it.
  The displayed hue comes from the canvas's background sub-palette (one palette,
  3 colors + backdrop) - this is the NES attribute-table reality.
- A static canvas (a logo, a gauge frame) settles over `~w*h` frames, then costs
  nothing. `nes.canvas_show()` commits the whole canvas in one dark frame.
- This covers the real uses (gauges, minimaps, plots, vector logos) without
  lying about full-screen 60fps effects, which are physically impossible here.

### 4. Blank-mode escape hatch

`nes.blank(true)` forces rendering off (the screen goes dark) and unlocks
unlimited VRAM writes for the full drawing verb set over the whole background;
`nes.blank(false)` re-enables rendering. Perfect for title screens, level
transitions, and "GAME OVER" cards - exactly where you want full drawing and a
dark screen is fine.

## Color

- The NES master palette is a fixed **64-entry** hardware table (~54 visually
  distinct). neslua colors are NES palette indices `0-63`.
- A static PICO-8 color literal `0-15` is **baked** at compile time to its
  nearest NES index (a curated table, `compiler/nes_palette.js`), so `cls(1)` is
  a sensible dark blue without you hand-picking indices. `nes.rgb(byte)` passes
  any raw NES index; `nes.rgb(r,g,b)` resolves the nearest at compile time.
- Palette reality: **4 BG palettes x 3 colors + one shared backdrop**, and BG
  palette choice has **16x16 px granularity** (attribute blocks). `nes.tpal(x,
  y, p)` sets the attribute palette for a tile region.

## Memory

- The standard neslua cart is **MMC1 (mapper 1)** with **8 KB of PRG-RAM at
  $6000** (battery-backed). Your `array()`/`pool()` storage + BSS live there;
  hot globals and the C stack stay in fast internal RAM.
- `array(n)` capacity caps at **2048** elements (well under the 8 KB PRG-RAM,
  leaving room for BSS and several arrays). `pool(n)` caps at 64.

## Input

Family button mapping (`btn(i)` / `btnp(i)`):

| i | button | NES |
|---|--------|-----|
| 0 | left   | D-pad Left |
| 1 | right  | D-pad Right |
| 2 | up     | D-pad Up |
| 3 | down   | D-pad Down |
| 4 | O      | **B** |
| 5 | X      | **A** |
| 6 | select | Select |
| 7 | start  | Start |

## Audio (v1)

`sfx(n)` fires a compiled effect on the APU pulse channel. Multi-channel
sequenced music (a pattern driver over pulse/triangle/noise) is a later
milestone; there are no `.nsf` playback claims.

## What's not in v1

- PRG bank switching (fixed 32 KB; MMC1 banking is a later milestone).
- Arbitrary sprite scaling (`sspr`): refused - use `spr` flips + pre-scaled
  sprite variants baked by the CHR encoder.
- Mid-frame raster tricks / IRQ splits.
