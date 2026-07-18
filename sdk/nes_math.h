/* nes_math.h - the neslua math surface.
 *
 * Thin umbrella over the 16.16 fixed-point runtime (ported near-verbatim from
 * the gtlua 6502 asm/C - the shared 6502 leverage the SDK family is built on).
 * The generated C from luacretro (target:"nes") calls nes_fmul / nes_fdiv /
 * nes_fsin / ... plus the zero-page fastcall entries nes_fmul_zp / nes_fdiv_zp
 * (operands staged in the zp longs fa/fb). Every symbol lives in nes_fixed.h.
 */
#ifndef NES_MATH_H
#define NES_MATH_H

#include "nes_fixed.h"

#endif /* NES_MATH_H */
