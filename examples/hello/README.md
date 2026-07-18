# hello

The family hello: a centered smiley + centered greeting. The smiley is drawn
into a **pixel canvas** (surface 3) with the P8 drawing verbs (1bpp: color 1
sets a pixel, color 0 clears it); the text is **background font tiles**
(surface 1). Static content is drawn once - the NES VRAM queue drains only ~16
tile writes per frame, so re-drawing an unchanged screen every frame would
saturate it.

```lua
local ready = 0

function _init()
  nes.canvas_at(6, 6, 13, 9)   -- a 6x6-tile canvas, centered, at tile row 9
  circfill(24, 24, 22, 1)      -- filled face
  circfill(16, 18, 3, 0)       -- left eye (cleared)
  circfill(32, 18, 3, 0)       -- right eye (cleared)
  line(14, 30, 20, 36, 0)      -- smile (cut out of the lower face)
  line(20, 36, 28, 36, 0)
  line(28, 36, 34, 30, 0)
  line(14, 31, 20, 37, 0)
  line(20, 37, 28, 37, 0)
  line(28, 37, 34, 31, 0)
end

function _draw()
  if (ready == 0) then
    cls(1)                                    -- dark-blue backdrop
    print("hello from neslua", 60, 176, 7)     -- centered greeting
    ready = 1
  end
end
```

![hello screenshot](screenshot.png)

*Real frame captured from the fceumm core (2x integer scale of native 256x224).*

```
neslua build main.lua -o hello.nes
```
