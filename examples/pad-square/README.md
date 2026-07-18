# pad-square

The family input contract: move a hardware sprite with the d-pad. The square is
a **sprite** (surface 2) - `spr(1, x, y)` pushes the built-in solid-block tile
onto the shadow OAM, DMA'd to the PPU every frame. Runs at 60fps (`_update60`).

```lua
local x = 120
local y = 112

function _update60()
  if (btn(1)) then x += 2 end      -- right
  if (btn(0)) then x -= 2 end      -- left
  if (btn(3)) then y += 2 end      -- down
  if (btn(2)) then y -= 2 end      -- up
  x = mid(8, x, 240)
  y = mid(16, y, 208)
end

function _draw()
  cls(12)                          -- sky-blue backdrop
  spr(1, x, y)                     -- the movable square
end
```

![pad-square screenshot](screenshot.png)

*Real frame captured from the fceumm core (2x integer scale of native 256x224).*

```
neslua build main.lua -o pad-square.nes
neslua run  main.lua                 # arrow keys move the square
```
