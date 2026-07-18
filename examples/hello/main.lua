-- hello neslua: a greeting + a little ship you fly around with the d-pad.
--
-- Build it with the sprite sheet:
--   neslua build examples/hello/main.lua --sheet examples/hello/ship.chr
--
-- The ship is a real hardware sprite: spr(0, x, y, 2, 2) is a 16x16 sprite (a
-- 2x2 block of 8x8 tiles) from the imported sheet, DMA'd to the PPU every frame,
-- so it moves for free. nes.spal(1) draws it in the cyan sub-palette. The
-- greeting is background tiles, written through the VRAM queue (~16 tiles/vblank),
-- so we lay it down ONCE and let it sit. Cheap sprites over a static background
-- is how the NES animates. Visible screen is 256x224.

local ready = 0
local x = 120
local y = 120

function _update60()             -- 60fps: read the d-pad, move the ship
  if (btn(1)) then x += 2 end    -- right
  if (btn(0)) then x -= 2 end    -- left
  if (btn(3)) then y += 2 end    -- down
  if (btn(2)) then y -= 2 end    -- up
  x = mid(8, x, 232)             -- keep the 16px-wide ship on screen
  y = mid(16, y, 200)
end

function _draw()
  if (ready == 0) then           -- background tiles: draw the greeting once
    cls(0)                       -- black backdrop (space)
    print("hello neslua", 72, 88, 7)
    ready = 1
  end
  nes.spal(1)                    -- cyan sprite sub-palette
  spr(0, x, y, 2, 2)             -- the ship (16x16), redrawn every frame
end
