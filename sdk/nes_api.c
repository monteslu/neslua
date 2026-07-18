/* nes_api.c - the neslua runtime (NES / cc65 / 6502).
 *
 * Implements the three-surface graphics model (docs/DIFFERENCES.md):
 *   1. background tiles via the VRAM queue (drained by the crt0 NMI handler)
 *   2. sprites via the shadow OAM at $0200 (DMA'd each frame)
 *   3. a small CHR-RAM pixel canvas the P8 drawing verbs paint into
 *   + blank-mode: the full verb set with rendering forced off
 *
 * The zero-page fastcall slots (nes_a0..a5, nes_p0..p4, cam, pad words) are
 * DEFINED here in the ZEROPAGE segment; the emitted C stages args into them and
 * calls the argless _z entries below.
 */
#include "nes_api.h"

/* ── PPU / APU register access ───────────────────────────────────────────── */
#define PPU_CTRL   (*(volatile u8*)0x2000)
#define PPU_MASK   (*(volatile u8*)0x2001)
#define PPU_STATUS (*(volatile u8*)0x2002)
#define PPU_SCROLL (*(volatile u8*)0x2005)
#define PPU_ADDR   (*(volatile u8*)0x2006)
#define PPU_DATA   (*(volatile u8*)0x2007)
#define OAM_ADDR   (*(volatile u8*)0x2003)
#define APU_STATUS (*(volatile u8*)0x4015)
#define APU_FRAME  (*(volatile u8*)0x4017)
#define JOY1       (*(volatile u8*)0x4016)
#define JOY2       (*(volatile u8*)0x4017)

/* PPUCTRL bits: NMI on ($80), sprite pattern $0000 (bit3=0), BG pattern $1000
 * (bit4=1), 8x8 sprites, base nametable 0. */
#define PPUCTRL_ON  0x90
#define PPUMASK_ON  0x1E   /* BG + sprites on, no clipping columns */

/* ── zero-page fastcall slots (see nes_api.h) ────────────────────────────── */
#pragma bss-name (push, "ZEROPAGE")
#pragma data-name (push, "ZEROPAGE")
int nes_a0, nes_a1, nes_a2, nes_a3, nes_a4, nes_a5;
int nes_p0, nes_p1, nes_p2, nes_p3, nes_p4;
int nes_cam_x, nes_cam_y;
u16 nes_pad0, nes_pad1, nes_rpt0, nes_rpt1;
#pragma data-name (pop)
#pragma bss-name (pop)

int nes_mret_1, nes_mret_2, nes_mret_3;

/* ── crt0-shared globals (the NMI handler reads these) ───────────────────── */
u8 _shadow_oam_hi;    /* placeholder to keep the linker happy if unreferenced */
volatile u8 nes_nmi_counter;
u8 nes_scroll_x, nes_scroll_y;
u8 nes_ppuctrl_value = PPUCTRL_ON;

/* VRAM write queue - 32-entry ring, drained 16/vblank by the crt0 in asm. */
#define QUEUE_MAX  32
#define QUEUE_MASK 31
u8 nes_vram_q_hi[QUEUE_MAX];
u8 nes_vram_q_lo[QUEUE_MAX];
u8 nes_vram_q_val[QUEUE_MAX];
u8 nes_vram_queue_head;
u8 nes_vram_queue_tail;
volatile u8 nes_vram_queue_len;
volatile u8 nes_vram_queue_lock;

/* shadow OAM lives at $0200 (crt0 owns _shadow_oam). Mirror the pointer. */
static u8 *const shadow_oam = (u8*)0x0200;
static u8 oam_next;          /* next free sprite slot (byte index, +4 each) */

/* ── low-level PPU helpers ───────────────────────────────────────────────── */
void ppu_wait_nmi(void) {
    u8 c = nes_nmi_counter;
    while (nes_nmi_counter == c) { /* spin until the NMI ticks */ }
}

static void ppu_wait_vblank(void) {
    while (!(PPU_STATUS & 0x80)) { }
}

static void ppu_off(void) {
    nes_ppuctrl_value = 0x10;       /* NMI off, keep BG pattern $1000 */
    PPU_CTRL = nes_ppuctrl_value;
    PPU_MASK = 0;
}

static void ppu_on(void) {
    nes_ppuctrl_value = PPUCTRL_ON;
    PPU_MASK = PPUMASK_ON;
}

/* direct VRAM write - PPU must be off (init / blank mode). */
static void vram_addr(u16 a) { PPU_ADDR = (u8)(a >> 8); PPU_ADDR = (u8)a; }
static void vram_put(u8 v)   { PPU_DATA = v; }

/* queue one byte write - drained next vblank by the NMI. Blocks (via
 * ppu_wait_nmi) when the queue is full so writes are never dropped. */
static void vram_queue(u16 a, u8 v) {
    while (nes_vram_queue_len >= QUEUE_MAX) ppu_wait_nmi();
    nes_vram_queue_lock = 1;
    nes_vram_q_hi[nes_vram_queue_tail] = (u8)(a >> 8);
    nes_vram_q_lo[nes_vram_queue_tail] = (u8)a;
    nes_vram_q_val[nes_vram_queue_tail] = v;
    nes_vram_queue_tail = (nes_vram_queue_tail + 1) & QUEUE_MASK;
    ++nes_vram_queue_len;
    nes_vram_queue_lock = 0;
}

/* ── the baked 1bpp font: digits, A-Z, space + punctuation ───────────────── */
/* 8x8 tiles uploaded to BG pattern table at tile $40+. Glyph rows are the low
 * 3 bits of a compact 3x5 cell (bit2 = leftmost), scaled to 8x8 on upload. */
static const u8 nes_font3x5[42][5] = {
    {7,5,5,5,7},{2,6,2,2,7},{7,1,7,4,7},{7,1,7,1,7},{5,5,7,1,1},
    {7,4,7,1,7},{7,4,7,5,7},{7,1,1,2,2},{7,5,7,5,7},{7,5,7,1,7},
    {7,5,7,5,5},{6,5,6,5,6},{7,4,4,4,7},{6,5,5,5,6},{7,4,7,4,7},
    {7,4,7,4,4},{7,4,5,5,7},{5,5,7,5,5},{7,2,2,2,7},{3,1,1,5,7},
    {5,5,6,5,5},{4,4,4,4,7},{5,7,7,5,5},{6,5,5,5,5},{7,5,5,5,7},
    {7,5,7,4,4},{7,5,5,7,3},{7,5,6,5,5},{7,4,7,1,7},{7,2,2,2,2},
    {5,5,5,5,7},{5,5,5,5,2},{5,5,7,7,5},{5,5,2,5,5},{5,5,7,2,2},
    {7,1,2,4,7},
    {0,0,0,0,0},{2,2,2,0,2},{0,0,7,0,0},{0,2,0,2,0},{0,0,0,0,2},
    {1,1,2,4,4},
};
#define FONT_BASE 0x40   /* first font tile index in the BG pattern table */

/* map an ASCII char to its font-tile index (BG nametable value). */
static u8 glyph_tile(char ch) {
    if (ch >= '0' && ch <= '9') return FONT_BASE + (ch - '0');
    if (ch >= 'A' && ch <= 'Z') return FONT_BASE + 10 + (ch - 'A');
    if (ch >= 'a' && ch <= 'z') return FONT_BASE + 10 + (ch - 'a');
    switch (ch) {
        case ' ': return FONT_BASE + 36;
        case '!': return FONT_BASE + 37;
        case '-': return FONT_BASE + 38;
        case ':': return FONT_BASE + 39;
        case '.': return FONT_BASE + 40;
        case '/': return FONT_BASE + 41;
        default:  return FONT_BASE + 36;   /* unknown -> space */
    }
}

/* upload the font glyphs to the BG pattern table ($1000 + tile*16). Each 3x5
 * cell expands to an 8x8 tile: the 3 source columns map to bits 6,5,4 of a
 * plane-0 row, doubled horizontally, and each of the 5 rows repeated once. */
static void font_upload(void) {
    u8 g, r, rows, bits;
    u16 base;
    for (g = 0; g < 42; ++g) {
        base = 0x1000 + (u16)(FONT_BASE + g) * 16;
        vram_addr(base);
        for (rows = 0; rows < 8; ++rows) {
            /* rows 1..6 show the 5 glyph rows (padded top/bottom by a blank) */
            if (rows >= 1 && rows <= 5) r = nes_font3x5[g][rows - 1];
            else r = 0;
            /* expand 3 bits (bit2=left) to 8px: cols at x=1,3,5 (2px wide) */
            bits = 0;
            if (r & 4) bits |= 0x60;   /* left  -> px 1-2 */
            if (r & 2) bits |= 0x18;   /* mid   -> px 3-4 */
            if (r & 1) bits |= 0x06;   /* right -> px 5-6 */
            vram_put(bits);
        }
        /* plane 1 (all zero -> color 1 of the palette) */
        for (rows = 0; rows < 8; ++rows) vram_put(0);
    }
}

/* ── the pixel canvas (surface 3) ────────────────────────────────────────── */
/* A cw x ch TILE window (cap 32 tiles) of CHR-RAM, mapped to a fixed nametable
 * region. Pixels live in a CPU-side 2bpp buffer; dirty tiles upload a few per
 * vblank via the queue. Canvas tiles start at pattern index $80. */
#define CANVAS_MAXTILES 64
#define CANVAS_TILE0    0x80
static u8 canvas_w, canvas_h;         /* window size in tiles */
static u8 canvas_tx, canvas_ty;       /* nametable placement (tile coords) */
static u8 canvas_px, canvas_py;       /* pixel dims (w*8, h*8) */
static u8 canvas_buf[CANVAS_MAXTILES][8];   /* plane-0 rows per tile (1bpp) */
static u8 canvas_dirty[CANVAS_MAXTILES];
static u8 nes_cur_color = 1;
static u8 in_blank;                   /* nes.blank state */

static void canvas_map_tiles(void) {
    /* point the placed nametable cells at the canvas pattern tiles + mark the
     * canvas tiles dirty so the first flush uploads them. */
    u8 tx, ty, idx;
    for (ty = 0; ty < canvas_h; ++ty) {
        for (tx = 0; tx < canvas_w; ++tx) {
            idx = ty * canvas_w + tx;
            vram_queue(0x2000 + (u16)(canvas_ty + ty) * 32 + (canvas_tx + tx),
                       CANVAS_TILE0 + idx);
        }
    }
}

void nes_canvas_at(int cw, int ch, int tx, int ty) {
    u8 i, j;
    if (cw < 1) cw = 1;
    if (ch < 1) ch = 1;
    if (cw * ch > CANVAS_MAXTILES) { ch = CANVAS_MAXTILES / cw; if (ch < 1) { ch = 1; cw = CANVAS_MAXTILES; } }
    canvas_w = (u8)cw; canvas_h = (u8)ch;
    canvas_tx = (u8)tx; canvas_ty = (u8)ty;
    canvas_px = canvas_w * 8; canvas_py = canvas_h * 8;
    for (i = 0; i < CANVAS_MAXTILES; ++i) {
        for (j = 0; j < 8; ++j) canvas_buf[i][j] = 0;
        canvas_dirty[i] = 1;
    }
    canvas_map_tiles();
}

void nes_canvas(int cw, int ch) {
    /* default placement: centered-ish, below the HUD (tile row 6). */
    int tx = (32 - cw) / 2; if (tx < 0) tx = 0;
    nes_canvas_at(cw, ch, tx, 6);
}

/* set/clear a canvas pixel. The canvas is 1bpp, so a color either turns the
 * pixel ON (shows the canvas ink color) or clears it (shows the backdrop). A
 * color that reads as black/backdrop erases: raw 0, or the NES black index $0F
 * (which the compiler bakes P8 color 0 to). Every other color sets. */
#define NES_BLACK 0x0F
static void canvas_pset(u8 x, u8 y, u8 col) {
    u8 tx, ty, tidx, bit;
    if (x >= canvas_px || y >= canvas_py) return;
    tx = x >> 3; ty = y >> 3;
    tidx = ty * canvas_w + tx;
    if (tidx >= CANVAS_MAXTILES) return;
    bit = 0x80 >> (x & 7);
    if (col != 0 && col != NES_BLACK) canvas_buf[tidx][y & 7] |= bit;
    else                              canvas_buf[tidx][y & 7] &= (u8)~bit;
    canvas_dirty[tidx] = 1;
}

static u8 canvas_pget(u8 x, u8 y) {
    u8 tx, ty, tidx, bit;
    if (x >= canvas_px || y >= canvas_py) return 0;
    tx = x >> 3; ty = y >> 3;
    tidx = ty * canvas_w + tx;
    if (tidx >= CANVAS_MAXTILES) return 0;
    bit = 0x80 >> (x & 7);
    return (canvas_buf[tidx][y & 7] & bit) ? nes_cur_color : 0;
}

/* Count dirty canvas tiles. */
static u8 canvas_dirty_count(void) {
    u8 i, n = 0, ntiles = canvas_w * canvas_h;
    for (i = 0; i < ntiles; ++i) if (canvas_dirty[i]) ++n;
    return n;
}

/* Upload every dirty canvas tile at once with rendering forced off (direct VRAM
 * writes, no queue). The screen goes dark for that frame - fine at boot / on a
 * big repaint, and the only way a full canvas lands promptly (the queue drains
 * just 16 single-byte entries/vblank = one tile/frame, so a queue-only path
 * would take dozens of frames and starve the text). */
static void canvas_commit_blank(void) {
    u8 i, r, ntiles = canvas_w * canvas_h;
    u16 base;
    if (canvas_w == 0) return;
    /* Force blank (PPUMASK=0) for the whole upload. With no active display there
     * is no vblank budget to overrun, so CHR writes are safe at any length.
     * Disable NMI too so the crt0 handler can't fire mid-burst and move PPUADDR.
     * Costs one dark frame. */
    PPU_CTRL = 0x10;             /* NMI off (keep BG pattern-table bit 4) */
    PPU_MASK = 0;                 /* rendering off */
    for (i = 0; i < ntiles; ++i) {
        if (!canvas_dirty[i]) continue;
        base = 0x1000 + (u16)(CANVAS_TILE0 + i) * 16;
        vram_addr(base);
        for (r = 0; r < 8; ++r) vram_put(canvas_buf[i][r]);
        for (r = 0; r < 8; ++r) vram_put(0);
        canvas_dirty[i] = 0;
    }
    /* reset PPUADDR + scroll, re-arm NMI, turn rendering back on. */
    vram_addr(0x2000);
    PPU_SCROLL = 0; PPU_SCROLL = 0;
    PPU_MASK = PPUMASK_ON;
    PPU_CTRL = nes_ppuctrl_value;   /* NMI back on */
}

/* Per-frame flush: drip ONE dirty canvas tile through the VRAM queue when the
 * queue has room (16 entries = a whole tile; the queue drains 16/vblank, so one
 * tile per frame keeps the screen lit and shares the queue with text). A fresh
 * full paint settles in ~(w*h) frames; a static canvas has no dirty tiles and
 * costs nothing. `nes.canvas_show()` is the instant (1-dark-frame) alternative. */
static void canvas_flush(void) {
    u8 i, r;
    u16 base;
    u8 ntiles = canvas_w * canvas_h;
    if (canvas_dirty_count() == 0) return;
    if (nes_vram_queue_len > QUEUE_MAX - 16) return;   /* no queue room */
    for (i = 0; i < ntiles; ++i) {
        if (!canvas_dirty[i]) continue;
        base = 0x1000 + (u16)(CANVAS_TILE0 + i) * 16;
        for (r = 0; r < 8; ++r) vram_queue(base + r, canvas_buf[i][r]);
        for (r = 0; r < 8; ++r) vram_queue(base + 8 + r, 0);
        canvas_dirty[i] = 0;
        return;
    }
}

/* nes.canvas_show(): hint that the canvas is fully painted. In v1 the canvas
 * uploads reliably through the per-frame queue drip (one tile/frame - a static
 * canvas settles in ~w*h frames), so this just re-marks every tile dirty so the
 * drip covers the whole window. (A forced-blank instant commit is a v1.1 item;
 * the queue path is the robust default and never disturbs rendering.) */
void nes_canvas_show(void) {
    u8 i, ntiles = canvas_w * canvas_h;
    for (i = 0; i < ntiles; ++i) canvas_dirty[i] = 1;
    (void)canvas_commit_blank;   /* retained for v1.1; not on the v1 path */
}

/* ── drawing primitives (paint the active surface) ───────────────────────── */
/* The active surface is the pixel canvas, unless blank-mode draws to the whole
 * background. v1 canvas primitives are 1bpp (color != 0 = set). */
static void prim_pset(int x, int y, int c) {
    x -= (nes_cam_x); y -= (nes_cam_y);
    if (x < 0 || y < 0) return;
    if (c >= 0) nes_cur_color = (u8)c;
    canvas_pset((u8)x, (u8)y, nes_cur_color);
}
static void prim_rectfill(int x0, int y0, int x1, int y1, int c) {
    int x, y, t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    if (c >= 0) nes_cur_color = (u8)c;
    for (y = y0; y <= y1; ++y)
        for (x = x0; x <= x1; ++x) prim_pset(x, y, -1);
}
static void prim_rect(int x0, int y0, int x1, int y1, int c) {
    int x, y, t;
    if (x0 > x1) { t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { t = y0; y0 = y1; y1 = t; }
    if (c >= 0) nes_cur_color = (u8)c;
    for (x = x0; x <= x1; ++x) { prim_pset(x, y0, -1); prim_pset(x, y1, -1); }
    for (y = y0; y <= y1; ++y) { prim_pset(x0, y, -1); prim_pset(x1, y, -1); }
}
static void prim_line(int x0, int y0, int x1, int y1, int c) {
    int dx = x1 - x0, dy = y1 - y0, sx = 1, sy = 1, err, e2;
    if (dx < 0) { dx = -dx; sx = -1; }
    if (dy < 0) { dy = -dy; sy = -1; }
    err = dx - dy;
    if (c >= 0) nes_cur_color = (u8)c;
    for (;;) {
        prim_pset(x0, y0, -1);
        if (x0 == x1 && y0 == y1) break;
        e2 = err << 1;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 <  dx) { err += dx; y0 += sy; }
    }
}
static void prim_circ(int cx, int cy, int r, int c, u8 fill) {
    int x = r, y = 0, err = 1 - r, xx;
    if (c >= 0) nes_cur_color = (u8)c;
    while (x >= y) {
        if (fill) {
            for (xx = cx - x; xx <= cx + x; ++xx) { prim_pset(xx, cy + y, -1); prim_pset(xx, cy - y, -1); }
            for (xx = cx - y; xx <= cx + y; ++xx) { prim_pset(xx, cy + x, -1); prim_pset(xx, cy - x, -1); }
        } else {
            prim_pset(cx + x, cy + y, -1); prim_pset(cx - x, cy + y, -1);
            prim_pset(cx + x, cy - y, -1); prim_pset(cx - x, cy - y, -1);
            prim_pset(cx + y, cy + x, -1); prim_pset(cx - y, cy + x, -1);
            prim_pset(cx + y, cy - x, -1); prim_pset(cx - y, cy - x, -1);
        }
        ++y;
        if (err < 0) err += 2 * y + 1;
        else { --x; err += 2 * (y - x) + 1; }
    }
}

/* cdecl entries */
void nes_pset(int x, int y, int c) { prim_pset(x, y, c); }
void nes_rect(int x0, int y0, int x1, int y1, int c) { prim_rect(x0, y0, x1, y1, c); }
void nes_rectfill(int x0, int y0, int x1, int y1, int c) { prim_rectfill(x0, y0, x1, y1, c); }
void nes_circ(int cx, int cy, int r, int c) { prim_circ(cx, cy, r, c, 0); }
void nes_circfill(int cx, int cy, int r, int c) { prim_circ(cx, cy, r, c, 1); }
void nes_line(int x0, int y0, int x1, int y1, int c) { prim_line(x0, y0, x1, y1, c); }
void nes_sset(int x, int y, int c) { if (c >= 0) nes_cur_color = (u8)c; canvas_pset((u8)x, (u8)y, nes_cur_color); }
int  nes_pget(int x, int y) { return canvas_pget((u8)x, (u8)y); }

/* zp entries: read nes_a0..a5, dispatch to the primitive. */
void nes_pset_z(void)     { prim_pset(nes_a0, nes_a1, nes_a2); }
void nes_rect_z(void)     { prim_rect(nes_a0, nes_a1, nes_a2, nes_a3, nes_a4); }
void nes_rectfill_z(void) { prim_rectfill(nes_a0, nes_a1, nes_a2, nes_a3, nes_a4); }
void nes_circ_z(void)     { prim_circ(nes_a0, nes_a1, nes_a2, nes_a3, 0); }
void nes_circfill_z(void) { prim_circ(nes_a0, nes_a1, nes_a2, nes_a3, 1); }
void nes_line_z(void)     { prim_line(nes_a0, nes_a1, nes_a2, nes_a3, nes_a4); }
void nes_sset_z(void)     { nes_sset(nes_a0, nes_a1, nes_a2); }

void __fastcall__ nes_color(int c) { nes_cur_color = (u8)c; }

/* ── background surface ──────────────────────────────────────────────────── */
void nes_tset(int x, int y, int t) {
    if (x < 0 || x > 31 || y < 0 || y > 29) return;
    vram_queue(0x2000 + (u16)y * 32 + x, (u8)t);
}

void nes_tpal(int x, int y, int p) {
    /* attribute byte covers a 4x4 tile group. Compute the attr address + the
     * 2-bit quadrant, then queue a whole-byte write (we track a shadow so the
     * other quadrants survive). */
    static u8 attr_shadow[64];
    u8 ax = (u8)x >> 2, ay = (u8)y >> 2, quad, shift;
    u8 idx = ay * 8 + ax;
    if (x < 0 || y < 0 || idx >= 64) return;
    quad = ((y & 2) ? 2 : 0) | ((x & 2) ? 1 : 0);
    shift = quad * 2;
    attr_shadow[idx] = (attr_shadow[idx] & (u8)~(3 << shift)) | (((u8)p & 3) << shift);
    vram_queue(0x23C0 + idx, attr_shadow[idx]);
}

void nes_cls(int c) {
    /* Background clear = set the backdrop color ($3F00). The nametable full
     * clear happens at init / in blank-mode; per-frame cls() just repaints the
     * backdrop, which is the visible "clear" on a tile machine. The pixel canvas
     * is NOT touched (it has its own clear via nes.canvas / drawing color 0), so
     * a smiley painted once in _init survives cls() called every frame. */
    nes_border(c);
}

/* clear the pixel canvas buffer (all pixels off). */
void nes_canvas_clear(void) {
    u8 i, j;
    for (i = 0; i < canvas_w * canvas_h; ++i) {
        for (j = 0; j < 8; ++j) canvas_buf[i][j] = 0;
        canvas_dirty[i] = 1;
    }
}

void nes_camera(int x, int y) {
    nes_cam_x = x; nes_cam_y = y;
    nes_scroll_x = (u8)x; nes_scroll_y = (u8)y;
}

void nes_border(int c) {
    /* backdrop color = palette entry $3F00. Queue it (safe during render). */
    vram_queue(0x3F00, (u8)c);
}

/* ── print(): font tiles into the nametable ──────────────────────────────── */
static u8 print_cx, print_cy;   /* running cursor (tile cells) for cursor-form */

static void print_at(const char *s, u8 tx, u8 ty) {
    while (*s && tx < 32) {
        nes_tset(tx, ty, glyph_tile(*s));
        ++s; ++tx;
    }
    print_cx = tx; print_cy = ty;
}

void nes_print(const char *s, int x, int y, int c) {
    (void)c;
    /* x,y are PIXEL coords in P8; convert to tile cells (>>3). */
    print_at(s, (u8)(x >> 3), (u8)(y >> 3));
}

/* render a u16 as up to 5 decimal digits (no leading zeros beyond one). */
static void print_u16_at(u16 v, u8 tx, u8 ty) {
    char buf[6]; int i = 5; buf[5] = 0;
    if (v == 0) buf[--i] = '0';
    while (v && i > 0) { buf[--i] = '0' + (v % 10); v /= 10; }
    print_at(&buf[i], tx, ty);
}

void nes_print_int(int v, int x, int y, int c) {
    (void)c;
    if (v < 0) { nes_tset(x >> 3, y >> 3, glyph_tile('-')); print_u16_at((u16)(-v), (x >> 3) + 1, y >> 3); }
    else print_u16_at((u16)v, (u8)(x >> 3), (u8)(y >> 3));
}

void nes_print_num(long v, int x, int y, int c) {
    /* integer part only in v1 (fixed 16.16 -> whole units). */
    nes_print_int((int)(v >> 16), x, y, c);
}

void nes_print_cur_str(const char *s, int c) { (void)c; print_at(s, print_cx, print_cy); print_cy++; print_cx = 0; }
void nes_print_cur_int(int v, int c) { (void)c; print_u16_at((u16)(v < 0 ? -v : v), print_cx, print_cy); print_cy++; print_cx = 0; }
void nes_print_cur_num(long v, int c) { nes_print_cur_int((int)(v >> 16), c); }

/* ── map(): stamp tiles from the imported __map__ ────────────────────────── */
void nes_map(const u8 *m, int w, int cx, int cy, int sx, int sy, int cw, int ch) {
    int i, j; u8 t;
    for (j = 0; j < ch; ++j) {
        for (i = 0; i < cw; ++i) {
            t = m[(cy + j) * w + (cx + i)];
            if (t) nes_tset((sx >> 3) + i, (sy >> 3) + j, t);
        }
    }
}

/* ── sprite surface ──────────────────────────────────────────────────────── */
void nes_oam_clear(void) {
    u8 i;
    for (i = 0; i < 64; ++i) shadow_oam[i * 4] = 0xFF;   /* Y = off-screen */
    oam_next = 0;
}

/* push one 8x8 hardware sprite (internal). attr packs palette + flip bits. */
static void oam_push(u8 x, u8 y, u8 tile, u8 attr) {
    if (oam_next >= 64) return;
    shadow_oam[oam_next * 4 + 0] = y - 1;   /* NES draws Y+1 */
    shadow_oam[oam_next * 4 + 1] = tile;
    shadow_oam[oam_next * 4 + 2] = attr;
    shadow_oam[oam_next * 4 + 3] = x;
    ++oam_next;
}

/* current sprite sub-palette (0-3), selected by nes_spal(). spr() ORs it into
 * the OAM attribute byte so different actors can use different colors. */
static u8 spr_pal;
void nes_spal(int p) { spr_pal = (u8)(p & 3); }

/* spr(n, x, y, w, h, flip): n = base sprite tile ($00 pattern table). w/h are
 * cell counts. flip bit0 = X, bit1 = Y. Uses the current nes_spal() palette. */
void nes_spr(int n, int x, int y, int w, int h, int flip) {
    u8 tx, ty, attr;
    int px, py;
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    attr = spr_pal;
    if (flip & 1) attr |= 0x40;
    if (flip & 2) attr |= 0x80;
    x -= nes_cam_x; y -= nes_cam_y;
    for (ty = 0; ty < h; ++ty) {
        for (tx = 0; tx < w; ++tx) {
            px = x + tx * 8; py = y + ty * 8;
            if (px < 0 || px > 248 || py < 0 || py > 232) continue;
            oam_push((u8)px, (u8)py, (u8)(n + ty * 16 + tx), attr);
        }
    }
}

void nes_spr_z(void) {
    /* a0=n a1=x a2=y a3=w a4=h a5=flip mask */
    nes_spr(nes_a0, nes_a1, nes_a2, nes_a3, nes_a4, nes_a5);
}

void nes_flicker(int on) { (void)on; /* OAM rotation reserved for M3 */ }

/* ── input ───────────────────────────────────────────────────────────────── */
/* Read a controller into an 8-bit word: bit order A,B,Select,Start,U,D,L,R. */
static u8 read_pad(u8 which) {
    volatile u8 *port = which ? &JOY2 : &JOY1;
    u8 i, v = 0;
    JOY1 = 1; JOY1 = 0;             /* strobe */
    for (i = 0; i < 8; ++i) { v = (v << 1) | (*port & 1); }
    return v;
}

/* raw NES pad bit per P8 index (A=$80 B=$40 Sel=$20 St=$10 U=8 D=4 L=2 R=1).
 * P8: 0=left 1=right 2=up 3=down 4=O 5=X 6=select 7=start. O=NES B, X=NES A. */
static const u8 raw_mask[8] = { 0x02, 0x01, 0x08, 0x04, 0x40, 0x80, 0x20, 0x10 };

/* PACKED-word mask per P8 index - MUST match the emitter's inline BTN_MASKS
 * (compiler/emit.js: [512,256,2056,1028,16,4096,8192,32]). btn(i) with a
 * constant index inlines to `(nes_pad0 & MASK) != 0`, so nes_update_inputs
 * packs the raw pad into THIS layout and nes_btn/nes_btnp read the same masks -
 * the inlined and the called paths always agree. */
static const u16 packed_mask[8] = { 512, 256, 2056, 1028, 16, 4096, 8192, 32 };

/* pack a raw NES pad byte into the family packed-word layout. */
static u16 pack_pad(u8 raw) {
    u16 w = 0; u8 i;
    for (i = 0; i < 8; ++i) if (raw & raw_mask[i]) w |= packed_mask[i];
    return w;
}

void nes_update_inputs(void) {
    u8 p0 = read_pad(0), p1 = read_pad(1);
    /* edge-detect for btnp: newly-pressed this frame. */
    static u8 prev0, prev1;
    u8 new0 = p0 & (u8)~prev0, new1 = p1 & (u8)~prev1;
    prev0 = p0; prev1 = p1;
    nes_pad0 = pack_pad(p0); nes_pad1 = pack_pad(p1);
    nes_rpt0 = pack_pad(new0); nes_rpt1 = pack_pad(new1);
}

u8 nes_btn(int i, int pl) {
    u16 w = pl ? nes_pad1 : nes_pad0;
    if (i < 0 || i > 7) return 0;
    return (w & packed_mask[i]) ? 1 : 0;
}
u8 nes_btnp(int i, int pl) {
    u16 w = pl ? nes_rpt1 : nes_rpt0;
    if (i < 0 || i > 7) return 0;
    return (w & packed_mask[i]) ? 1 : 0;
}

/* ── blank-mode escape hatch ─────────────────────────────────────────────── */
void nes_blank(int on) {
    if (on) { ppu_wait_nmi(); ppu_off(); in_blank = 1; }
    else    { in_blank = 0; ppu_on(); }
}

/* ── sound (sfx v1) ──────────────────────────────────────────────────────── */
void nes_audio_init(void) {
    APU_STATUS = 0x0F;   /* pulse1+pulse2+triangle+noise on */
    APU_FRAME  = 0x40;   /* 4-step, disable frame IRQ */
}
void nes_sfx(int n, int ch) {
    /* v1 fixed effect bank: a short blip on pulse1 (n selects pitch). */
    (void)ch;
    *(volatile u8*)0x4000 = 0x8F;                 /* duty 2, constant vol 15 */
    *(volatile u8*)0x4002 = (u8)(0x40 + (n & 7) * 8);
    *(volatile u8*)0x4003 = 0x18;                 /* length + timer hi */
}

/* ── nes.* extras ────────────────────────────────────────────────────────── */
int nes_ticks(void) { return (int)nes_p8_time(); }

/* ── lifecycle ───────────────────────────────────────────────────────────── */
/* the default palette: universal backdrop dark blue, BG palette 0 = white
 * text ramp, sprite palette 0 = a warm ramp. */
static const u8 default_palette[32] = {
    0x0F, 0x30, 0x21, 0x11,   /* BG0: backdrop, white, cyan, blue */
    0x0F, 0x27, 0x16, 0x06,   /* BG1: orange ramp (canvas) */
    0x0F, 0x2A, 0x1A, 0x0A,   /* BG2: green ramp */
    0x0F, 0x30, 0x10, 0x00,   /* BG3: grey ramp */
    0x0F, 0x16, 0x30, 0x27,   /* SPR0: red/white/orange (invader) */
    0x0F, 0x21, 0x30, 0x11,   /* SPR1: cyan/white/blue (ship) */
    0x0F, 0x2A, 0x3A, 0x30,   /* SPR2: green/lt-green/white (shot) */
    0x0F, 0x28, 0x17, 0x30,   /* SPR3: yellow/orange/white (burst) */
};

static void palette_load(const u8 *p) {
    u8 i;
    vram_addr(0x3F00);
    for (i = 0; i < 32; ++i) vram_put(p[i]);
}

/* Upload a few default SPRITE tiles to the sprite pattern table ($0000) so
 * spr(n,...) shows something on a bare cart (no imported sheet). Tile 1 = a
 * solid 8x8 block, tile 2 = a filled ball/dot, tile 3 = a diamond. A cart with
 * its own art overwrites these. */
static const u8 default_sprites[3][8] = {
    { 0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF,0xFF },   /* tile 1: solid block */
    { 0x3C,0x7E,0xFF,0xFF,0xFF,0xFF,0x7E,0x3C },   /* tile 2: filled ball */
    { 0x18,0x3C,0x7E,0xFF,0xFF,0x7E,0x3C,0x18 },   /* tile 3: diamond */
};
/* An imported sprite sheet (--sheet): raw CHR bytes emitted as a C unit by the
 * build. nes_sheet_len == 0 on a bare cart, in which case we upload the three
 * built-in default tiles instead. */
extern const unsigned char nes_sheet_data[];
extern const unsigned int nes_sheet_len;

static void sprite_tiles_upload(void) {
    u8 t, r;
    if (nes_sheet_len != 0) {
        /* upload the imported sheet starting at sprite tile 0 ($0000). */
        u16 i;
        vram_addr(0x0000);
        for (i = 0; i < nes_sheet_len; ++i) vram_put(nes_sheet_data[i]);
        return;
    }
    for (t = 0; t < 3; ++t) {
        vram_addr(0x0000 + (u16)(t + 1) * 16);
        for (r = 0; r < 8; ++r) vram_put(default_sprites[t][r]);   /* plane 0 */
        for (r = 0; r < 8; ++r) vram_put(0);                       /* plane 1 */
    }
}

/* clear the whole nametable to tile 0 (init only, PPU off). */
static void nametable_clear(void) {
    u16 i;
    vram_addr(0x2000);
    for (i = 0; i < 0x3C0; ++i) vram_put(0);
    for (i = 0; i < 0x40; ++i) vram_put(0);    /* attributes */
}

void nes_init(void) {
    ppu_off();
    ppu_wait_vblank();
    nametable_clear();
    font_upload();
    sprite_tiles_upload();
    palette_load(default_palette);
    nes_oam_clear();
    /* prime the queue state */
    nes_vram_queue_head = nes_vram_queue_tail = nes_vram_queue_len = 0;
    nes_scroll_x = nes_scroll_y = 0;
    /* one frame with rendering on to settle, then enable NMI. */
    ppu_wait_vblank();
    ppu_on();
    PPU_CTRL = nes_ppuctrl_value;   /* NMI on now */
}

void nes_endframe(void) {
    nes_time_tick();
    if (canvas_w) canvas_flush();
    ppu_wait_nmi();
}
