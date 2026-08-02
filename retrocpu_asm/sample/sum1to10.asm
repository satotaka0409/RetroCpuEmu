; MN1610 sample: sum 1..10 and store result, then halt
; Expected RESULT = 55 (0x0037)

        .org 0

START:  MVI R0, #0        ; sum = 0
        MVI R1, #10       ; i = 10

LOOP:   A   R0, R1        ; sum += i
        SI  R1, #1, Z     ; i -= 1, if i == 0 then skip next instruction
        B   LOOP          ; continue while i != 0

        ST  R0, RESULT    ; store sum to one-word area
        H

RESULT: .word 0
