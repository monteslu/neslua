/* nes_api.h - the neslua runtime surface (NES / cc65 / 6502).
 *
 * The generated C from luacretro (target:"nes") calls into this API. Names
 * follow the shared gt_* schema collapsed to nes_* by the emitter's final pass
 * (so nes_p8_cls -> nes_cls, nes_p8_spr -> nes_spr, ...).
 *
 * ── The three-surface graphics model (see docs/DIFFERENCES.md) ──────────────
 * The NES has NO framebuffer. neslua exposes three real surfaces plus one
 * escape hatch instead of pretending a full-screen pset canvas exists:
 *
 *   1. BACKGROUND  tiles in the nametable (map/print/tset/tpal via the VRAM
 *      queue, drained 24 entries/vblank by the NMI handler).
 *   2. SPRITES     spr() -> the 64-entry shadow-OAM at $0200, DMA'd each frame.
 *   3. PIXEL CANVAS a small CHR-RAM window (canvas(w,h)) the P8 drawing verbs
 *      (pset/line/rect/rectfill/circ/circfill) paint into a CPU-side 2bpp
 *      buffer; dirty tiles upload a few per vblank.
 *   +  BLANK MODE  nes_blank(cb): the full verb set with rendering forced off.
 *
 * Coordinate space is the hardware's 256x240; standard NTSC output crops to
 * 256x224 visible (8px top + 8px bottom overscan). Keep HUD text at tile row 2+
 * and bottom prompts at row 27 or earlier.
 */
#ifndef NES_API_H
#define NES_API_H

#include "nes_math.h"

typedef unsigned char u8;
typedef unsigned int  u16;

/* ── zero-page fastcall ABI ──────────────────────────────────────────────────
 * The emitter stages draw-builtin args into nes_a0..a5 and calls the argless
 * _z entry; user-fn params ride nes_p0..p4; the camera offset + latched pad
 * words live in zp too (constant-button btn() inlines a bit test on them). */
extern int nes_a0, nes_a1, nes_a2, nes_a3, nes_a4, nes_a5;
extern int nes_p0, nes_p1, nes_p2, nes_p3, nes_p4;
extern int nes_cam_x, nes_cam_y;
extern u16 nes_pad0, nes_pad1, nes_rpt0, nes_rpt1;
#pragma zpsym ("nes_a0")
#pragma zpsym ("nes_a1")
#pragma zpsym ("nes_a2")
#pragma zpsym ("nes_a3")
#pragma zpsym ("nes_a4")
#pragma zpsym ("nes_a5")
#pragma zpsym ("nes_p0")
#pragma zpsym ("nes_p1")
#pragma zpsym ("nes_p2")
#pragma zpsym ("nes_p3")
#pragma zpsym ("nes_p4")
#pragma zpsym ("nes_cam_x")
#pragma zpsym ("nes_cam_y")
#pragma zpsym ("nes_pad0")
#pragma zpsym ("nes_pad1")
#pragma zpsym ("nes_rpt0")
#pragma zpsym ("nes_rpt1")

/* multiple-return output slots (return a,b,c) - written by the callee, read by
 * the caller right after the call. Widest kind any fn returns in that slot. */
extern int  nes_mret_1, nes_mret_2, nes_mret_3;

/* ── lifecycle (the generated main() calls these) ────────────────────────── */
void nes_init(void);            /* PPU up, palette + font CHR, rendering on */
void nes_audio_init(void);      /* enable APU channels (only if the cart uses sfx) */
void nes_update_inputs(void);   /* latch both pads into the nes_pad / nes_rpt words */
void nes_oam_clear(void);       /* hide all 64 sprites (shadow-OAM Y=$FF), reset cursor */
void nes_endframe(void);        /* time tick + canvas flush + ppu_wait_nmi (OAM DMA + queue drain) */

/* ── input ───────────────────────────────────────────────────────────────── */
/* P8 index: 0=left 1=right 2=up 3=down 4=O(NES B) 5=X(NES A) 6=select 7=start */
u8 nes_btn(int i, int pl);
u8 nes_btnp(int i, int pl);

/* ── background surface (tiles / text) ───────────────────────────────────── */
void nes_cls(int c);                          /* fill nametable + backdrop color */
void nes_camera(int x, int y);                /* fine scroll offset (committed at vblank) */
void __fastcall__ nes_color(int c);           /* current draw color for the canvas */
void nes_tset(int x, int y, int t);           /* queue one nametable tile write */
void nes_tpal(int x, int y, int p);           /* queue an attribute (16x16) palette write */

/* print(): baked 1bpp font -> nametable tiles. 32x28 visible text cells. */
void nes_print(const char *s, int x, int y, int c);
void nes_print_int(int v, int x, int y, int c);
void nes_print_num(long v, int x, int y, int c);
void nes_print_cur_str(const char *s, int c);
void nes_print_cur_int(int v, int c);
void nes_print_cur_num(long v, int c);

/* map(cx,cy,sx,sy,cw,ch): stamp tiles from the imported __map__ (128 wide). */
void nes_map(const u8 *m, int w, int cx, int cy, int sx, int sy, int cw, int ch);

/* ── sprite surface ──────────────────────────────────────────────────────── */
/* spr(n,x,y,[w,h,fx,fy]): push 8x8 sprite tiles onto the shadow OAM. w/h are
 * cell counts (1 = 8px). The zp entry reads nes_a0..a5 (flips packed in a5). */
void nes_spr(int n, int x, int y, int w, int h, int flip);
void nes_spr_z(void);
void nes_flicker(int on);                     /* OAM rotation for >8/scanline crowds */

/* ── pixel canvas (constrained P8 drawing) ───────────────────────────────── */
/* canvas(cw,ch): reserve a cw x ch TILE window (cap 32 tiles) of CHR-RAM at a
 * fixed nametable region; the P8 verbs draw into a CPU-side 2bpp buffer that
 * uploads a few dirty tiles per vblank. One BG palette (3 colors + backdrop). */
void nes_canvas(int cw, int ch);
void nes_canvas_at(int cw, int ch, int tx, int ty);   /* nes.canvas_at: place the window */
void nes_canvas_clear(void);                          /* nes.canvas_clear: blank the canvas */
void nes_canvas_show(void);                           /* nes.canvas_show: commit the canvas now (1 dark frame) */

/* the zero-page draw entries (args in nes_a0..a5). They paint the ACTIVE
 * surface: the pixel canvas, or - inside nes_blank - the whole background. */
void nes_pset_z(void);       /* a0=x a1=y a2=c */
void nes_rect_z(void);       /* a0=x0 a1=y0 a2=x1 a3=y1 a4=c */
void nes_rectfill_z(void);   /* a0=x0 a1=y0 a2=x1 a3=y1 a4=c */
void nes_circ_z(void);       /* a0=cx a1=cy a2=r a3=c */
void nes_circfill_z(void);   /* a0=cx a1=cy a2=r a3=c */
void nes_line_z(void);       /* a0=x0 a1=y0 a2=x1 a3=y1 a4=c */
void nes_sset_z(void);       /* a0=x a1=y a2=c (write a canvas pixel directly) */
int  nes_pget(int x, int y); /* read a canvas pixel */

/* the cdecl fallbacks (used when a draw arg contains a user call) */
void nes_pset(int x, int y, int c);
void nes_rect(int x0, int y0, int x1, int y1, int c);
void nes_rectfill(int x0, int y0, int x1, int y1, int c);
void nes_circ(int cx, int cy, int r, int c);
void nes_circfill(int cx, int cy, int r, int c);
void nes_line(int x0, int y0, int x1, int y1, int c);
void nes_sset(int x, int y, int c);

/* ── blank-mode escape hatch (nes.blank / nes.blankdraw) ─────────────────── */
/* nes.blank(true) forces rendering OFF (screen dark) and unlocks unlimited
 * VRAM writes for the full P8 verb set over the whole 32x30 background; the
 * next nes.blank(false) re-enables rendering. Perfect for title/transition
 * cards. Costs the frames it stays dark. */
void nes_blank(int on);

/* ── sound (APU pulse/triangle/noise; sfx only in v1) ────────────────────── */
void nes_sfx(int n, int ch);                  /* fire compiled effect n (0-7) */

/* ── nes.* extras ────────────────────────────────────────────────────────── */
int  nes_ticks(void);                         /* frames since boot */
void nes_border(int c);                       /* backdrop / overscan color */

#endif /* NES_API_H */
