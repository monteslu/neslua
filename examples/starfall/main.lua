-- STARFALL - a complete little shmup for the NES, in neslua.
-- Move with the d-pad, fire with B. Clear the invaders to win; don't let one
-- reach your row. Same game as the GBA and Genesis starfall, rebuilt for the
-- NES's tighter hardware: 8x8 sprite tiles (each actor is a 2x2 block), FOUR
-- sprite sub-palettes (nes.spal picks one per actor), a background-tile
-- starfield, and a HUD drawn once through the VRAM queue.
--
-- Two NES rules shape this port:
--  * 64 hardware sprites, 8 PER SCANLINE. Every actor is 2x2 = 4 tiles, so the
--    12 invaders alone are 48 tiles. The formation is STAGGERED (even/odd
--    columns sit on different rows, 40px apart) so no scanline carries more
--    than three invaders (6 tiles <= the 8/line cap) and none vanish.
--  * The starfield is BACKGROUND, not sprites. Painting the stars into the
--    nametable once (through the VRAM queue) keeps all 64 sprites free for the
--    ship, invaders, shots and burst - the correct NES division of labor.
--
-- build: neslua build examples/starfall/main.lua \
--          --sheet examples/starfall/shmup_sheet.chr

-- ---- sheet tiles: ship=0 (2x2), invader=2 (2x2), burst=4 (2x2), bullet=8 (1x1)
-- sub-palettes: invader=0 (red), ship=1 (cyan), shot=2 (green), burst=3 (yellow)

-- ---- state -----------------------------------------------------------------
local px = 120        -- player x (screen 256 wide, ship 16 wide)
local py = 196
local pcool = 0       -- fire cooldown

-- bullets (6 max): x, y, active
local bx = array(6)
local by = array(6)
local ba = array8(6)

-- enemies (a 6x2 staggered grid = 12): x, y, alive; the whole formation drifts
local enx = array(12)
local eny = array(12)
local eal = array8(12)
local edir = 1        -- formation drift direction
local edx = 0         -- accumulated formation x offset
local alive = 12

-- one explosion burst (the last kill): position + frames left
local lex = 0
local ley = 0
local let = 0

local score = 0
local lives = 3
local state = 0       -- 0 = playing, 1 = win, 2 = lose
local drawn = 0       -- HUD + starfield "draw once" guard
local starstep = 0    -- how many star tiles have been laid down so far
local hudscore = -1   -- last score painted (repaint only on change)

function setup()
  -- lay out the enemy formation: 6 columns, staggered into two visual rows so
  -- no scanline carries more than 3 invaders (6 tiles <= the 8/scanline cap).
  for i = 1, 12 do
    local col = (i - 1) % 6
    local row = (i - 1) \ 6
    enx[i] = 24 + col * 40
    -- Odd columns drop a FULL sprite height (16px). Because an invader is 16px
    -- tall, no scanline then holds both an even and an odd column at once, so
    -- any scanline crosses at most the 3 even OR the 3 odd columns = 6 sprite
    -- tiles - comfortably under the 8-per-scanline cap, leaving room for shots.
    eny[i] = 28 + row * 48 + (col % 2) * 16
    eal[i] = 1
  end
  for i = 1, 6 do ba[i] = 0 end
end

function _init()
  setup()
end

function fire()
  for i = 1, 6 do
    if ba[i] == 0 then
      bx[i] = px + 4
      by[i] = py - 8
      ba[i] = 1
      sfx(0)
      return
    end
  end
end

function reset_game()
  px = 120; py = 196; pcool = 0
  edir = 1; edx = 0; alive = 12; let = 0
  score = 0; lives = 3; state = 0
  drawn = 0; starstep = 0; hudscore = -1
  setup()
end

function _update()
  if state != 0 then
    if btnp(4) then reset_game() end
    return
  end

  -- player movement
  if btn(0) then px -= 3 end
  if btn(1) then px += 3 end
  if px < 8 then px = 8 end
  if px > 232 then px = 232 end

  -- fire
  if pcool > 0 then pcool -= 1 end
  if btn(4) and pcool == 0 then
    fire()
    pcool = 8
  end

  -- move bullets up
  for i = 1, 6 do
    if ba[i] != 0 then
      by[i] -= 6
      if by[i] < 0 then ba[i] = 0 end
    end
  end

  -- drift the enemy formation side to side
  edx += edir
  if edx > 20 then edir = -1 end
  if edx < -20 then edir = 1 end

  -- explosion burst timer
  if let > 0 then let -= 1 end

  -- bullet vs enemy collision + enemy update
  for e = 1, 12 do
    if eal[e] != 0 then
      local ex = enx[e] + edx
      local ey = eny[e]
      -- lose if an enemy reaches the player's row
      if ey > 176 then
        state = 2
        return
      end
      for i = 1, 6 do
        if ba[i] != 0 then
          local dx = bx[i] - ex
          local dy = by[i] - ey
          if dx > -12 and dx < 12 and dy > -12 and dy < 12 then
            eal[e] = 0
            ba[i] = 0
            score += 10
            alive -= 1
            lex = ex
            ley = ey
            let = 12
            sfx(0)
          end
        end
      end
    end
  end

  if alive <= 0 then state = 1 end
end

function _draw()
  -- static backdrop + HUD labels: draw ONCE through the VRAM queue
  if drawn == 0 then
    cls(1)                         -- deep-space backdrop (dark blue)
    print("score", 8, 8, 7)
    print("lives", 200, 8, 7)
    drawn = 1
  end
  -- the starfield is background tiles. The VRAM queue drains ~16 tiles/vblank,
  -- so we spread the 24 stars over several frames instead of flooding it: a
  -- couple of "." glyphs per frame until the field is complete, then it sits.
  if starstep < 24 then
    local i = starstep + 1
    -- a hash-scatter across the playfield (rows 3..25, avoiding the HUD row)
    local sx = (i * 47) % 30 + 1
    local sy = (i * 71) % 22 + 3
    print(".", sx * 8, sy * 8, 6)
    print(".", ((i * 29) % 30 + 1) * 8, ((i * 53) % 22 + 3) * 8, 7)
    starstep += 2
  end

  if state == 1 then
    print("you win", 96, 112, 11)
    print("press b", 96, 128, 12)
    return
  end
  if state == 2 then
    print("game over", 88, 112, 8)
    print("press b", 96, 128, 12)
    return
  end

  -- repaint the score digits only when they change (a few tiles, no saturation)
  if score != hudscore then
    print(score, 56, 8, 10)
    print(lives, 248, 8, 8)
    hudscore = score
  end

  -- enemies: the red invader (cells 2-3 / 18-19), sub-palette 0
  nes.spal(0)
  for e = 1, 12 do
    if eal[e] != 0 then
      spr(2, enx[e] + edx, eny[e], 2, 2)
    end
  end

  -- the kill burst (cells 4-5 / 20-21), sub-palette 3 (yellow)
  if let > 0 then
    nes.spal(3)
    spr(4, lex, ley, 2, 2)
  end

  -- shots: a compact 1-tile green bolt (tile 8), sub-palette 2. Single-tile
  -- bullets keep the sprite budget clear of the 8-per-scanline / 64-total caps.
  nes.spal(2)
  for i = 1, 6 do
    if ba[i] != 0 then spr(8, bx[i], by[i]) end
  end

  -- the player ship (cells 0-1 / 16-17), sub-palette 1 (cyan)
  nes.spal(1)
  spr(0, px, py, 2, 2)
end
