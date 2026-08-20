; handshake_address_break.asm
; 比較器ブレイク設定・解除（IO→CPU 10h / 11h）
; 根拠: HandShake.mdc / TMS9995_CPUボードメモリ_IOマップ.mdc（CRU 0040–005F）
;
; コマンド 1B は IRQ ディスパッチ済み。
; 10h 残り 9B: slot, flags, count, addr32 BE, data16 BE → 送信 1B status
; 11h 残り 1B: slot → 送信 1B status
; スロット 0–3。表は GL_HSHK_ADDR_BREAK（6 語×4）。CRU へもプログラムする。
; 呼び出し: BL / B (R11)。ステータスは R1。ネスト時は R11 を退避。
; 注意: g_hshk_recv/send は R3–R5 を壊すので、表ポインタは R7・slot は R6。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr
	.global g_hshk_addr_break_init
	.global GL_HSHK_ADDR_BREAK
	.global g_hshk_recv_byte
	.global g_hshk_send_byte

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; アドレスブレイク設定（10h ペイロード）
; return R1 HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_addr_break_set:
	MOV	R11, R8

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R1, R6			; slot
	ANDI	R6, #0x00ff
	CI	R6, #HSHK_AB_SLOTS
	JHE	l_ab_set_bad

	; R7 = &GL_HSHK_ADDR_BREAK[slot]（バイト: slot*12）
	MOV	R6, R0
	SLA	R0, #1			; *2
	MOV	R0, R1
	SLA	R0, #1			; *4
	A	R1, R0			; *6 words
	SLA	R0, #1			; *12 bytes
	AI	R0, #GL_HSHK_ADDR_BREAK
	MOV	R0, R7

	LI	R0, #1
	MOV	R0, 0(R7)		; ena

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	ANDI	R1, #0x00ff
	MOV	R1, 2(R7)		; flags

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	ANDI	R1, #0x00ff
	MOV	R1, 4(R7)		; count

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R1, 6(R7)		; addr_hi

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R1, 8(R7)		; addr_lo

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R1, 10(R7)		; data

	BL	l_ab_cru_program

	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	B	(R8)

l_ab_set_bad:
	LI	R10, #8
l_ab_set_drain:
	MOV	R10, R10
	JEQ	l_ab_set_drain_done
	BL	g_hshk_recv_byte
	AI	R10, #-1
	JMP	l_ab_set_drain
l_ab_set_drain_done:
	LI	R1, #HSHK_NG
	BL	g_hshk_send_byte
	B	(R8)

l_ab_set_fail:
	LI	R1, #HSHK_NG
	B	(R8)

; -------------------------------------------------------
; アドレスブレイク解除（11h）
; return R1 HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_addr_break_clr:
	MOV	R11, R8

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_clr_fail
	MOV	R1, R6
	ANDI	R6, #0x00ff
	CI	R6, #HSHK_AB_SLOTS
	JHE	l_ab_clr_bad

	MOV	R6, R0
	SLA	R0, #1
	MOV	R0, R1
	SLA	R0, #1
	A	R1, R0
	SLA	R0, #1
	AI	R0, #GL_HSHK_ADDR_BREAK
	MOV	R0, R7

	LI	R1, #HSHK_AB_SLOT_WORDS
l_ab_clr_z:
	CLR	(R7)+
	AI	R1, #-1
	JNE	l_ab_clr_z

	LI	R12, #IO_BREAK_NUM_OUT
	LDCR	R6, #3
	LI	R12, #0
	SBZ	#IO_BREAK_ENA

	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	B	(R8)

l_ab_clr_bad:
	LI	R1, #HSHK_NG
	BL	g_hshk_send_byte
	B	(R8)

l_ab_clr_fail:
	LI	R1, #HSHK_NG
	B	(R8)

; -------------------------------------------------------
; 表クリア（リセット後用）
; -------------------------------------------------------
g_hshk_addr_break_init:
	LI	R1, #GL_HSHK_ADDR_BREAK
	LI	R2, #HSHK_AB_TBL_WORDS
l_ab_init_lp:
	CLR	(R1)+
	AI	R2, #-1
	JNE	l_ab_init_lp
	B	(R11)

; -------------------------------------------------------
; BE 2 バイト → R1。ステータスは R2
; -------------------------------------------------------
l_ab_recv_word:
	MOV	R11, R9
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_rw_fail
	MOV	R1, R10
	SWPB	R10
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_rw_fail
	SOC	R1, R10
	MOV	R10, R1
	LI	R2, #HSHK_OK
	B	(R9)
l_ab_rw_fail:
	CLR	R1
	LI	R2, #HSHK_NG
	B	(R9)

; -------------------------------------------------------
; CRU へ比較器を書く（表 R7・slot R6 から読む）
; -------------------------------------------------------
l_ab_cru_program:
	MOV	R11, R9
	LI	R12, #IO_BREAK_NUM_OUT
	LDCR	R6, #3

	LI	R12, #0
	SBO	#IO_BREAK_ENA

	MOV	2(R7), R0		; flags
	MOV	R0, R1
	ANDI	R1, #HSHK_AB_F_IO
	JEQ	l_ab_cru_mem
	SBO	#IO_BREAK_MEMIO
	JMP	l_ab_cru_rdwr
l_ab_cru_mem:
	SBZ	#IO_BREAK_MEMIO
l_ab_cru_rdwr:
	SRL	R0, #1
	ANDI	R0, #0x0003
	LI	R12, #IO_BREAK_RDWR
	LDCR	R0, #2

	MOV	8(R7), R0		; addr_lo
	LI	R12, #IO_BREAK_ADDR
	LDCR	R0, #0			; 16bit
	B	(R9)

	.area	_WORK		(REL,NOLOAD)
; スロット 0–3 × 6 語: ena / flags / count / addr_hi / addr_lo / data
GL_HSHK_ADDR_BREAK:	.blkw	HSHK_AB_TBL_WORDS
