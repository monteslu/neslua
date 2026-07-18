-- hello neslua: a greeting + one hardware sprite you move with the d-pad.
--
-- The idiomatic NES hello. The sprite is real hardware: spr(1, x, y) pushes a
-- tile into shadow OAM, DMA'd to the PPU every frame, so it moves for free (the
-- NES draws up to 64 sprites, each independent). spr(1) is the bare cart's
-- built-in block tile - no art file needed. The greeting is background tiles,
-- written through the VRAM queue (~16 tiles/vblank), so we lay it down ONCE and
-- let it sit. Cheap sprites over a static background is how the NES animates.
-- Native coords are 256x240; visible is 256x224 (8px overscan top+bottom).

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
