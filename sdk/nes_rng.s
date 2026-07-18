; nes_rng.s - 16-bit xorshift(7,9,8) PRNG (ported verbatim from the gtlua
; blitter's fast RNG; pure NMOS 6502). nes_math.c's rnd()/srand() drive it.
;
; nes_rng_next() returns the next state as a cc65 int (A=lo, X=hi). Never yields
; 0 (a nonzero seed cycles the full 65535-value orbit). ~40 cycles/call.
        .setcpu "6502"
        .export _nes_rng_next
        .export _nes_rng_state

        .bss
_nes_rng_state: .res 2

        .code
_nes_rng_next:
        ; s ^= s << 7
        LDA _nes_rng_state+1
        LSR A
        LDA _nes_rng_state
        ROR A
        EOR _nes_rng_state+1
        STA _nes_rng_state+1
        LDA _nes_rng_state
        LSR A
        LDA #0
        ROR A
        EOR _nes_rng_state
        STA _nes_rng_state
        ; s ^= s >> 9
        LDA _nes_rng_state+1
        LSR A
        EOR _nes_rng_state
        STA _nes_rng_state
        ; s ^= s << 8
        EOR _nes_rng_state+1
        STA _nes_rng_state+1
        TAX
        LDA _nes_rng_state
        RTS
