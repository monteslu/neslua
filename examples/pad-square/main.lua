-- pad-square - the neslua family input contract: move a sprite with the d-pad.
--
-- The square is a hardware sprite (surface 2): spr(1, x, y) pushes the built-in
-- solid-block tile onto the shadow OAM, DMA'd to the PPU every frame. Input is
-- btn(0..3) = the d-pad. 60fps (_update60).

local x = 120
local y = 112

function _update60()
  if (btn(1)) then x += 2 end      -- right
  if (btn(0)) then x -= 2 end      -- left
  if (btn(3)) then y += 2 end      -- down
  if (btn(2)) then y -= 2 end      -- up
  -- clamp to the visible playfield (256x224 with a little margin)
  x = mid(8, x, 240)
  y = mid(16, y, 208)
end

function _draw()
  cls(12)                          -- sky-blue backdrop
  spr(1, x, y)                     -- the movable square
end
