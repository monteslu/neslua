# starfall (NES)

A complete little shmup: move with the d-pad, fire with **B**. Clear the
staggered invader formation; don't let one reach your row. The same game the
GBA and Genesis SDKs ship, rebuilt for the NES's tighter hardware.

<p align="center">
  <img src="https://raw.githubusercontent.com/monteslu/neslua/main/examples/starfall/screenshot.png" width="480" alt="starfall on the NES: a staggered formation of red invaders, a cyan player ship firing a green bolt, over a starfield with a score/lives HUD">
</p>

## Build & run

```sh
neslua run examples/starfall/main.lua --sheet examples/starfall/shmup_sheet.chr
```

`--sheet` uploads a CHR sprite sheet to the pattern table at boot (a `.chr`
blob, or a `.png` that the build quantizes per tile). Regenerate the art with:

```sh
node examples/starfall/build_sheet.mjs   # writes shmup_sheet.png + shmup_sheet.chr
```

## What the NES made us do differently

The GBA and Genesis versions lean on a framebuffer-ish tile plane and fat 16x16
sprites. The NES is stricter, and the port is an honest lesson in its limits:

- **8x8 sprite tiles, composed as 2x2 blocks.** Every actor (ship, invader,
  shot's big form, burst) is `spr(n, x, y, 2, 2)` - four hardware sprites. The
  sheet is 128px wide so the runtime's `n, n+1 / n+16, n+17` tile stride lines
  up the top and bottom halves.
- **64 sprites, 8 per scanline.** Twelve invaders is 48 sprite tiles on its
  own. The formation is **staggered**: odd columns drop a full 16px, so no
  scanline ever holds both an even and an odd column - at most 3 invaders
  (6 tiles) cross any line, leaving headroom for shots so nothing vanishes.
- **Shots are single tiles.** A 2x2 bullet would be 24 tiles for six shots; a
  1-tile green bolt keeps the budget clear.
- **Four sprite sub-palettes via `nes.spal(0..3)`.** Each 8x8 tile is 3 colors +
  transparent. `nes.spal` picks the sub-palette a `spr` call uses, so the ship
  is cyan, invaders red, shots green and the burst yellow - all at once.
- **The starfield is BACKGROUND, not sprites.** It is painted into the
  nametable once (a couple of `"."` glyphs per frame through the VRAM queue),
  which keeps all 64 sprites free for the actors.
- **The HUD is drawn once.** `score`/`lives` labels are laid down on the first
  frame; only the digits repaint, and only when they change - the VRAM queue
  drains ~16 tiles/vblank and can't take a full repaint every frame.
