; neslua crt0 - MMC1 (mapper 1) + CHR-RAM + the sprite-engine NMI handler.
;
; Forked from romdev's chr-ram-runtime crt0 (the canonical NES sprite/VRAM-queue
; sequence), with MMC1 32KB-PRG init added and BSS living in PRG-RAM at $6000.
;
; The NMI handler is the canonical vblank sequence:
;   1. preserve A/X/Y
;   2. OAM DMA: $02 -> $4014 (copies shadow_oam[256] @ $0200 -> PPU OAM, 513 cyc)
;   3. drain the VRAM queue (16 entries/vblank; matches nes_api.c QUEUE_MAX 32)
;   4. reset PPUADDR to $2000 (else the queue's last $2006 leaves a dangling latch)
;   5. PPUSCROLL from scroll_x/scroll_y (fine-scroll camera)
;   6. PPUCTRL from ppuctrl_value (NMI enable + pattern-table bits)
;   7. bump nmi_counter so ppu_wait_nmi() returns
;   8. restore A/X/Y, rti

        .export         _exit
        .export         __STARTUP__ : absolute = 1
        .export         start
        .export         nmi
        .export         irq
        .export         _shadow_oam

        .import         initlib, donelib, callmain
        .import         _main, zerobss, copydata
        .import         __RAM_START__, __RAM_SIZE__
        .import         __SRAM_START__, __SRAM_SIZE__
        .import         _nes_vram_q_hi, _nes_vram_q_lo, _nes_vram_q_val
        .import         _nes_vram_queue_head, _nes_vram_queue_len, _nes_vram_queue_lock

; Must match nes_api.c (QUEUE_MAX 32 ring buffer).
QUEUE_MASK   = 31
FLUSH_BUDGET = 16
        .import         _nes_scroll_x, _nes_scroll_y, _nes_ppuctrl_value, _nes_nmi_counter
        .importzp       c_sp

; ------------------------------------------------------------------------
; 16-byte iNES header - MMC1 (mapper 1), CHR-RAM, 32K PRG, battery PRG-RAM.

.segment "HEADER"
        .byte   $4e, $45, $53, $1a   ; "NES" + EOF
        .byte   2                    ; PRG-ROM banks (16K each) -> 32K
        .byte   0                    ; CHR-ROM banks (8K each)  -> 0 = CHR-RAM
        .byte   %00010011            ; flags6: mapper lo nybble = 1 (MMC1),
                                     ; battery (bit1) + vertical mirroring (bit0).
                                     ; Battery maps persistent 8KB PRG-RAM at
                                     ; $6000-$7FFF where BSS + game arrays live.
        .byte   %00000000            ; flags7: mapper hi nybble = 0 -> mapper 1
        .byte   0, 0, 0, 0, 0, 0, 0, 0

; ------------------------------------------------------------------------
.segment "STARTUP"

start:
        sei
        cld
        ldx     #$ff
        txs

        ; Disable everything that could fire during init.
        lda     #0
        sta     $2000           ; disable NMI
        sta     $2001           ; disable rendering
        sta     $4010           ; disable DMC IRQ
        sta     $4015           ; disable APU channels
        bit     $2002           ; clear vblank flag

        ; ── MMC1 init: reset the shift register, then program the control
        ; register for 32KB PRG mode + CHR-RAM + vertical mirroring.
        ; Writing bit7=1 to any $8000-$FFFF address resets the serial latch.
        lda     #$80
        sta     $8000           ; reset MMC1 shift register
        ; Control reg ($8000): PRG mode 0 (bits 3-2 = 00 -> switch 32KB at
        ; $8000), CHR mode 0 (bit4 = 0), mirroring bits 1-0 = 10 (vertical).
        ; Value %00010 = $02: mirroring=vertical, PRG=32K, CHR=8K. Serialize
        ; the 5 bits LSB-first via five bit0 writes to $8000.
        lda     #$02
        jsr     mmc1_write_ctrl
        ; PRG bank reg ($E000): bank 0, WRAM enabled (bit4 = 0 = enable).
        lda     #$00
        jsr     mmc1_write_prg

        ; Wait two VBlanks before touching the PPU (standard NES init).
@vbl1:  bit     $2002
        bpl     @vbl1
@vbl2:  bit     $2002
        bpl     @vbl2

        ; Initialise shadow_oam to Y=$FF (off-screen) before anything else.
        ldx     #0
        lda     #$ff
@oam:   sta     _shadow_oam,x
        inx
        bne     @oam

        ; Clear CHR-RAM ($0000-$1FFF on the PPU bus) so tile 0 is blank.
        lda     #0
        sta     $2006           ; PPUADDR hi = $00
        sta     $2006           ; PPUADDR lo = $00
        ldx     #32             ; 32 x 256 = 8192 bytes
        ldy     #0
@chrclr_outer:
@chrclr_inner:
        sta     $2007
        iny
        bne     @chrclr_inner
        dex
        bne     @chrclr_outer

        ; Clear BSS + copy DATA (cc65 conventions). BSS is in PRG-RAM ($6000).
        jsr     zerobss
        jsr     copydata

        ; Set up cc65's C parameter stack pointer (top of SRAM window).
        lda     #<(__SRAM_START__ + __SRAM_SIZE__)
        ldx     #>(__SRAM_START__ + __SRAM_SIZE__)
        sta     c_sp
        stx     c_sp+1

        jsr     initlib
        jsr     callmain

_exit:  jsr     donelib
        jmp     start

; ------------------------------------------------------------------------
; MMC1 serial write helpers: A holds the 5-bit value, written LSB-first as
; five single-bit writes (bit0 of each) to the target $8000-block register.
; Writing bit7=0 five times shifts the value in; the 5th write commits it.
mmc1_write_ctrl:
        ldx     #5
@l:     sta     $8000
        lsr     a
        dex
        bne     @l
        rts
mmc1_write_prg:
        ldx     #5
@l:     sta     $E000
        lsr     a
        dex
        bne     @l
        rts

; ------------------------------------------------------------------------
; NMI handler - runs every vblank when ppuctrl bit 7 is set.

.segment "STARTUP"

nmi:
        pha
        txa
        pha
        tya
        pha

        ; OAM DMA: copy 256 bytes from $0200 to PPU OAM (513 cycles).
        lda     #$00
        sta     $2003           ; PPU OAMADDR = 0
        lda     #$02            ; high byte of $0200
        sta     $4014           ; PPU OAMDMA

        ; ── Drain the VRAM queue in ASM (a C flush would blow past vblank and
        ; corrupt writes during active rendering). ~40 cycles per entry.
        lda     _nes_vram_queue_lock
        bne     @flush_done     ; a push is mid-flight - skip this vblank
        lda     _nes_vram_queue_len
        beq     @flush_done
        cmp     #FLUSH_BUDGET
        bcc     @flush_n_ok
        lda     #FLUSH_BUDGET
@flush_n_ok:
        sta     nmi_drain
        sta     nmi_drained
        bit     $2002           ; reset the PPUADDR write latch
        ldx     _nes_vram_queue_head
@flush_loop:
        lda     _nes_vram_q_hi,x
        sta     $2006
        lda     _nes_vram_q_lo,x
        sta     $2006
        lda     _nes_vram_q_val,x
        sta     $2007
        inx
        txa
        and     #QUEUE_MASK
        tax
        dec     nmi_drain
        bne     @flush_loop
        stx     _nes_vram_queue_head
        lda     _nes_vram_queue_len
        sec
        sbc     nmi_drained
        sta     _nes_vram_queue_len
@flush_done:

        ; Reset PPUADDR to $2000 (else the queue's last $2006 leaves a dangling
        ; latch and the PPU samples random VRAM as the background).
        bit     $2002
        lda     #$20
        sta     $2006
        lda     #$00
        sta     $2006

        ; Set scroll from the cached fine-scroll globals (x then y).
        lda     _nes_scroll_x
        sta     $2005
        lda     _nes_scroll_y
        sta     $2005

        ; Re-enable NMI + pattern-table bits via the cached PPUCTRL value.
        lda     _nes_ppuctrl_value
        sta     $2000

        ; Tick the frame counter so ppu_wait_nmi can return.
        inc     _nes_nmi_counter

        pla
        tay
        pla
        tax
        pla
        rti

irq:    rti

; ------------------------------------------------------------------------
; Shadow OAM at $0200 - the NMI handler DMAs this to the PPU each frame.
.segment "OAM"
_shadow_oam: .res 256

; ------------------------------------------------------------------------
; NMI-private temporaries (NOT cc65's tmp1-4, which the NMI would corrupt).
.segment "BSS"
nmi_drain:   .res 1
nmi_drained: .res 1

.segment "VECTORS"
        .word   nmi             ; $FFFA
        .word   start           ; $FFFC
        .word   irq             ; $FFFE
