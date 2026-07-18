/* nes_fixed.h - 16.16 fixed-point runtime with PICO-8 semantics.
 * Numbers are signed 32-bit (C long): 16 integer bits, 16 fraction bits.
 * Overflow wraps; division by zero saturates to +/-0x7FFF.FFFF (P8 manual). */
#ifndef NES_FIXED_H
#define NES_FIXED_H

#ifdef NES_NUM8
/* 8.8 mode (--num8): fixed is 8.8 in a 16-bit int - range +-127.996, steps
 * of 1/256. Same public names, int signatures; the emitter never touches the
 * zp fa/fb fastcall (that unit is 16.16 asm and isn't linked). min/max/mid/
 * abs/sgn are scale-invariant, so the int helpers serve both kinds. */
int  nes_fmul(int a, int b);
int  nes_fdiv(int a, int b);

/* zp fastcall for the hot 8.8 multiply (nes_fixed8_asm.s): operands staged in
 * the zp ints fa/fb, argless call. Divide has no zp entry in 8.8 (it's C). */
extern int fa, fb;
#pragma zpsym ("fa")
#pragma zpsym ("fb")
int nes_fmul_zp(void);
int nes_fdiv_zp(void);           /* returns fa/fb (8.8 asm), /0 saturates */
int  nes_ratio8(int min, int max); /* (min<<8)/max in 0..255; 8-round divide for atan2 */
int  nes_fsqrt(int x);
int  nes_ffmod(int a, int b);
int  nes_fsin(int turns);
int  nes_fcos(int turns);
int  nes_fatan2(int dx, int dy);
int  nes_p8_rnd(int x);
int  nes_p8_rnd_int(int n);  /* integer-range rnd, no fixed multiply */
void nes_p8_srand(int seed);
int  nes_p8_time(void);
int  nes_ifdiv(int a, int b);
int  nes_ifmod(int a, int b);
int  nes_absi(int x);
int  nes_sgni(int x);
int  nes_mini(int a, int b);
int  nes_maxi(int a, int b);
int  nes_midi(int a, int b, int c);
#else

long nes_fmul(long a, long b);
long nes_fdiv(long a, long b);

/* zero-page fastcall ABI for the two hot 16.16 ops (nes_fixed_asm.s). The
 * emitter, at a multiply/divide whose operands don't themselves contain a
 * fixed mul/div, stores the operands straight into the zp longs fa/fb and
 * calls the argless entry - dropping cc65's per-call C-stack marshalling
 * (the `jsr pusheax` that spills the first arg). Nested/mixed sites still use
 * the cdecl nes_fmul/nes_fdiv above (the zp slots would collide). */
extern long fa, fb;
#pragma zpsym ("fa")
#pragma zpsym ("fb")
long nes_fmul_zp(void);          /* returns fa*fb  (16.16), sign of fa^fb */
long nes_fdiv_zp(void);          /* returns fa/fb  (16.16), /0 saturates  */

long nes_fsqrt(long x);
long nes_ffmod(long a, long b);      /* floored modulo, sign of divisor */
int  nes_ifdiv(int a, int b);        /* flr(a/b) for ints */
int  nes_ifmod(int a, int b);        /* floored modulo for ints */

int  nes_absi(int x);
long nes_absf(long x);
int  nes_sgni(int x);                /* sgn(0) == 1, per PICO-8 */
int  nes_sgnf(long x);
int  nes_mini(int a, int b);
int  nes_maxi(int a, int b);
int  nes_midi(int a, int b, int c);
long nes_minf(long a, long b);
long nes_maxf(long a, long b);
long nes_midf(long a, long b, long c);

long nes_fsin(long turns);
long nes_fcos(long turns);
long nes_fatan2(long dx, long dy);
long nes_p8_rnd(long x);
int  nes_p8_rnd_int(int n);  /* integer-range rnd, no fixed multiply */
void nes_p8_srand(long seed);
long nes_p8_time(void);
#endif /* NES_NUM8 */

void nes_time_tick(void);

#endif
