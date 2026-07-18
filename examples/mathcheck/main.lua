-- mathcheck - the fixed-point conformance cart.
--
-- Exercises the 16.16 fixed-point runtime (PICO-8 semantics) and stores results
-- in module globals so a test can read them straight out of RAM (the family's
-- numeric golden pattern). Each global holds a 16.16 raw value unless noted.

local r_add   = 0.0    -- 1.5 + 2.25            = 3.75
local r_mul   = 0.0    -- 1.5 * 2.0             = 3.0
local r_div   = 0.0    -- 3.0 / 2.0             = 1.5
local r_flrdiv = 0     -- -9 \ 2  (floored)     = -5  (int)
local r_mod   = 0.0    -- -9 % 2  (floored)     = 1.0
local r_sqrt  = 0.0    -- sqrt(2.0)             ~ 1.4142
local r_sin   = 0.0    -- sin(0.25)             = -1.0 (P8 screen-space)
local r_cos   = 0.0    -- cos(0.5)              = -1.0
local r_abs   = 0.0    -- abs(-3.5)             = 3.5
local r_min   = 0      -- min(4, 7)             = 4  (int)
local r_max   = 0      -- max(4, 7)             = 7  (int)
local r_flr   = 0      -- flr(3.75)             = 3  (int)
local shown   = 0

function _init()
  r_add    = 1.5 + 2.25
  r_mul    = 1.5 * 2.0
  r_div    = 3.0 / 2.0
  r_flrdiv = -9 \ 2
  r_mod    = -9 % 2
  r_sqrt   = sqrt(2.0)
  r_sin    = sin(0.25)
  r_cos    = cos(0.5)
  r_abs    = abs(-3.5)
  r_min    = min(4, 7)
  r_max    = max(4, 7)
  r_flr    = flr(3.75)
end

function _update() end

function _draw()
  if (shown == 0) then
    cls(0)
    -- surface the results on screen too (integer parts), as a sanity read.
    print("mathcheck", 88, 24, 7)
    print(flr(r_add), 40, 56, 7)
    print(r_flrdiv, 40, 72, 7)
    print(r_min, 40, 88, 7)
    print(r_max, 40, 104, 7)
    shown = 1
  end
end
