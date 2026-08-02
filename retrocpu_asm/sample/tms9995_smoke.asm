; TMS9995 smoke sample (phase-1)
; assemble: npm run assemble -- --cpu tms9995 sample/tms9995_smoke.asm

        .org    >1000
START:  LI      R1, >0040
        LI      R2, >0001
LOOP:   A       R2, R1
        CI      R1, >0100
        JNE     LOOP
        BL      @SUB
        B       @START
SUB:    CLR     R0
        RT
