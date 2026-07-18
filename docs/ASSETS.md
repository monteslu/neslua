# neslua assets

## Sprite / background art -> CHR

The NES stores tiles as **CHR** (pattern tables): 8x8 tiles, 16 bytes each
(two 1-bit planes = 2 bits per pixel). A pattern table holds **256 tiles**.

- The PICO-8 sprite-sheet convention maps **perfectly**: a **128 x 128 PNG** is
  256 8x8 tiles = exactly one pattern table.
- neslua ships a bare cart with a built-in 1bpp font (uploaded to the BG
  pattern table at tile `$40+`) and three default sprite tiles. Import your own
  art to replace them.

### PNG -> CHR

Convert a PNG sprite sheet to a raw CHR blob with the SDK's converter:

```
node compiler/chr-encode.mjs sheet.png -o sheet.chr
```

Each 8x8 tile must use at most 4 colors (one NES sub-palette: 3 colors +
transparent/backdrop). The converter quantizes to the nearest NES palette and
reports any tile that needed more colors than fit.

### Raw CHR

A raw 4 KB or 8 KB `.chr` blob is accepted as-is (no conversion):

```
neslua build main.lua --sheet sheet.chr -o game.nes
```

## Color-count reality

- Each 8x8 sprite tile: 3 colors + transparent (one sprite sub-palette).
- Each 16x16 background attribute region: 3 colors + backdrop (one BG
  sub-palette). BG palette choice has 16x16 px granularity - see DIFFERENCES.md.
- The NES master palette is a fixed 64-entry hardware table. All art quantizes
  to it.

## Tilemaps

A `map()`-drawable tilemap is imported as a byte array (the `__map__`
convention, 128 tiles wide). `mget(x, y)` reads a cell; `map(cx, cy, sx, sy,
cw, ch)` stamps a block into the nametable.

## Audio

`sfx(n)` fires a compiled effect on the APU. A build-time sfx table from a small
text format and a music pattern driver are later milestones.
