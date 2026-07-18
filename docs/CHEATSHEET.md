# neslua cheatsheet

PICO-8-flavored Lua -> a real NES `.nes` ROM. Coordinate space **256 x 240**;
visible **256 x 224** (8px overscan top+bottom). Keep HUD text at tile row 2+.

## Program shape

```lua
local score = 0            -- top-level: constant-initialized module state only

function _init()  ... end   -- runs once at boot (optional)
function _update()  ... end  -- 30 fps logic (or _update60 for 60 fps)
function _draw()  ... end     -- draws each frame
```

Define `_update` (30fps) OR `_update60` (60fps), plus `_draw`. No top-level
statements other than `local` declarations; runtime init goes in `_init()`.

## Numbers (PICO-8 16.16 fixed point)

Signed 32-bit, 16 integer + 16 fraction bits. Overflow wraps; `/0` saturates.
`\` = floor division, `%` = floored modulo, `//` is a comment.

## Background (tiles) - surface 1

```lua
cls(c)                 -- set the backdrop color (once per screen, not per frame)
print(s, x, y, c)      -- text at pixel x,y (snaps to 8x8 cells); 32x28 cells
nes.tset(x, y, tile)   -- write one nametable tile (tile coords)
nes.tpal(x, y, p)      -- set a 16x16 attribute region to BG palette p (0-3)
nes.camera(x, y)       -- fine-scroll offset (committed at vblank)
map(cx, cy, sx, sy, cw, ch)   -- stamp tiles from the imported __map__
```

## Sprites - surface 2

```lua
spr(n, x, y)                    -- one 8x8 sprite tile from the sprite sheet
spr(n, x, y, w, h)              -- a w x h cell block
spr(n, x, y, w, h, fx, fy)      -- with horizontal / vertical flip
```

Default tiles on a bare cart: 1 = solid block, 2 = ball, 3 = diamond.
64 sprites max, 8 per scanline.

## Pixel canvas - surface 3 (the P8 drawing verbs)

```lua
nes.canvas(cw, ch)              -- reserve a cw x ch tile window (cap 64 tiles)
nes.canvas_at(cw, ch, tx, ty)   -- ...at tile position tx,ty
nes.canvas_clear()              -- blank the canvas
nes.canvas_show()               -- commit the whole canvas now (one dark frame)

pset(x, y, c)    pget(x, y)     -- 1bpp: c != 0 sets a pixel, c == 0 clears it
line(x0,y0,x1,y1,c)
rect(x0,y0,x1,y1,c)   rectfill(x0,y0,x1,y1,c)
circ(x,y,r,c)         circfill(x,y,r,c)
```

Canvas coords are canvas-local pixels. A static canvas settles over ~w*h frames.

## Blank mode (full drawing, screen dark)

```lua
nes.blank(true)     -- rendering off; the full verb set writes the whole BG
-- ...draw a title card...
nes.blank(false)    -- rendering back on
```

## Input

```lua
btn(i)    btnp(i)     -- 0=left 1=right 2=up 3=down 4=O(B) 5=X(A) 6=select 7=start
```

## Math (PICO-8)

```lua
flr ceil abs sgn sqrt min max mid
sin cos atan2         -- in TURNS (1.0 = full circle), P8 screen-space
rnd srand t/time
band bor bxor bnot shl shr lshr   -- (also the & | ^^ ~ << >> >>> operators)
```

## Static allocation (lands in the 8KB PRG-RAM at $6000)

```lua
local a = array(64)          -- 1-based; #a = capacity (cap 2048)
local b = array8(64)         -- byte elements 0-255 (half the RAM)
local levels = {1, 2, 3}     -- constant read-only table
local bullets = pool(32)     -- struct pool (cap 64); add/del/all
```

## Color

NES palette indices 0-63. A static P8 literal 0-15 bakes to its nearest NES
index at compile time. `nes.rgb(byte)` = any raw index; `nes.rgb(r,g,b)` =
nearest at compile time. `nes.border(c)` = backdrop/overscan color.

## Audio (v1)

```lua
sfx(n)                -- fire compiled effect n (0-7) on the APU pulse channel
```

## Build

```
neslua build main.lua -o game.nes    # bundled cc65 WASM, zero native tools
neslua run   main.lua                 # build + play in a window
neslua c     main.lua                 # print the generated C (debugging)
```
