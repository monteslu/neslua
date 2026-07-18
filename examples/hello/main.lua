-- hello neslua: hardware sprites in motion. Move the block with the d-pad while
-- a swarm of balls and diamonds bounces around it.
--
-- This is how you actually make an NES game. Every shape here is a real hardware
-- sprite (surface 2), pushed into shadow OAM and DMA'd to the PPU every frame -
-- the NES draws up to 64 of them and moves each freely, for free. spr(1)=the
-- built-in block, spr(2)=ball, spr(3)=diamond (a bare cart ships these default
-- tiles, so no art file is needed). The greeting is background tiles, written
-- through the VRAM queue (~16 tiles/vblank), so we lay it down ONCE and let it
-- sit. Cheap sprites over a static background: that's the NES animation model.
-- Native coord space is 256x240; visible is 256x224 (8px overscan top+bottom).

local ready = 0
local x = 120                    -- the player block
local y = 180
local n = 6                      -- the drifting swarm
local sx = array(6)
local sy = array(6)
local vx = array(6)
local vy = array(6)

function _init()
  for i = 1, n do
    sx[i] = 24 + i * 32
    sy[i] = 48 + (i % 3) * 24
    vx[i] = 1 + (i % 2)          -- a mix of speeds so it never looks lockstep
    vy[i] = 1
  end
end

function _update60()             -- 60fps input + movement
  if (btn(1)) then x += 2 end    -- right
  if (btn(0)) then x -= 2 end    -- left
  if (btn(3)) then y += 2 end    -- down
  if (btn(2)) then y -= 2 end    -- up
  x = mid(8, x, 240)             -- clamp the block to the visible playfield
  y = mid(16, y, 208)
  for i = 1, n do                -- bounce the swarm off the walls
    sx[i] += vx[i]
    sy[i] += vy[i]
    if (sx[i] < 8 or sx[i] > 240) then vx[i] = -vx[i] end
    if (sy[i] < 48 or sy[i] > 150) then vy[i] = -vy[i] end
  end
end

function _draw()
  if (ready == 0) then           -- static backdrop + greeting: draw once
    cls(12)                      -- sky-blue backdrop
    print("hello neslua", 72, 24, 7)
    ready = 1
  end
  for i = 1, n do                -- the swarm: balls (2) and diamonds (3)
    spr(2 + (i % 2), sx[i], sy[i])
  end
  spr(1, x, y)                   -- the player block, redrawn every frame
end
