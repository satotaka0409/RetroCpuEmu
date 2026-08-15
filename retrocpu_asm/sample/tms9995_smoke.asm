; TMS9995 smoke sample (sdas syntax)
; assemble: npm run assemble -- --cpu tms9995 sample/tms9995_smoke.asm

	.cpu	tms9995

        .org    0x1000
START:  LI      R1, #0x0040
        LI      R2, #0x0001
LOOP:   A       R2, R1
        CI      R1, #0x0100
        JNE     LOOP
        BL      SUB
        B       START
SUB:    CLR     R0
        RT
