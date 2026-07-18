-- canvas - the pixel-canvas surface (surface 3): a CHR-RAM window the P8
-- drawing verbs paint into. This demo draws a bordered box with a diagonal and
-- a filled circle - a static "vector logo" that settles over a second (the NES
-- VRAM queue drains ~16 writes/frame, so the canvas uploads a tile per frame).

function _init()
  -- an 8x6-tile canvas (64x48 px) centered, at tile row 8.
  nes.canvas_at(8, 6, 12, 8)
  rect(1, 1, 62, 46, 1)         -- border
  line(1, 1, 62, 46, 1)         -- diagonal
  line(62, 1, 1, 46, 1)         -- anti-diagonal
  circfill(32, 24, 10, 1)       -- center bloom
  circ(32, 24, 16, 1)           -- ring
end

function _draw()
  -- backdrop only (once); the canvas content is drawn in _init.
  cls(0)
end
