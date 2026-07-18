-- hello - the neslua family hello: a centered smiley + centered text.
--
-- The smiley is drawn into a pixel canvas (surface 3): a CHR-RAM window the P8
-- drawing verbs paint into (1bpp - color 1 sets a pixel, color 0 clears it).
-- The greeting is background font tiles (surface 1). Native coord space is
-- 256x240; visible is 256x224 (8px overscan top+bottom), so content sits in the
-- safe middle rows.
--
-- Static content (backdrop, text, the smiley) is drawn ONCE: the NES VRAM queue
-- drains only ~16 tile writes per frame, so re-queueing an unchanged screen
-- every frame would saturate the queue. Draw once, let it settle.

local ready = 0

function _init()
  -- a 6x6-tile canvas (48x48 px) centered horizontally, at tile row 9.
  nes.canvas_at(6, 6, 13, 9)
  -- paint the smiley ONCE into the canvas buffer (it uploads a tile per frame).
  circfill(24, 24, 22, 1)     -- filled face
  circfill(16, 18, 3, 0)      -- left eye (cleared)
  circfill(32, 18, 3, 0)      -- right eye (cleared)
  line(14, 30, 20, 36, 0)     -- smile (cut out of the lower face)
  line(20, 36, 28, 36, 0)
  line(28, 36, 34, 30, 0)
  line(14, 31, 20, 37, 0)
  line(20, 37, 28, 37, 0)
  line(28, 37, 34, 31, 0)
end

function _draw()
  if (ready == 0) then
    cls(1)                              -- dark-blue backdrop (once)
    print("hello from neslua", 60, 176, 7)   -- centered greeting (once)
    ready = 1
  end
end
