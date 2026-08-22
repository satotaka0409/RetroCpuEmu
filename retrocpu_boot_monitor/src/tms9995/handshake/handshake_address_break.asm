; 比較器ブレイク設定・解除（IO→CPU 10h / 11h）
; 根拠: HandShake.mdc / TMS9995_CPUボードメモリ_IOマップ.mdc（FE80–FE83）
;
; コマンド 1B は IRQ ディスパッチ済み。
; 10h 残り 9B: slot, flags, count, addr32 BE, data16 BE → 送信 1B status
; 11h 残り 1B: slot → 送信 1B status
; スロット 0–3。表は GL_HSHK_ADDR_BREAK（6 語×4）。FE80 メモリ IO へもプログラムする。
; 呼び出し: BL / B (R11)。ステータスは R2。ネスト時は R11 を退避。
; 注意: g_hshk_recv/send は R0–R3 を壊すので、表ポインタは R7・slot は R6（入口で退避）。

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
; @return R2 - HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_addr_break_set:
	MOV	R11, R8
	DECT	R10
	MOV	R7, (R10)
	DECT	R10
	MOV	R6, (R10)

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R3, R6			; slot
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
	ANDI	R3, #0x00ff
	MOV	R3, 2(R7)		; flags

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	ANDI	R3, #0x00ff
	MOV	R3, 4(R7)		; count

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R3, 6(R7)		; addr_hi

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R3, 8(R7)		; addr_lo

	BL	l_ab_recv_word
	CI	R2, #HSHK_OK
	JNE	l_ab_set_fail
	MOV	R3, 10(R7)		; data

	BL	l_ab_cru_program

	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	JMP	l_ab_set_ret

l_ab_set_bad:
	LI	R5, #8
l_ab_set_drain:
	MOV	R5, R5
	JEQ	l_ab_set_drain_done
	BL	g_hshk_recv_byte
	AI	R5, #-1
	JMP	l_ab_set_drain
l_ab_set_drain_done:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
	JMP	l_ab_set_ret

l_ab_set_fail:
	LI	R2, #HSHK_NG

l_ab_set_ret:
	MOV	(R10)+, R6
	MOV	(R10)+, R7
	B	(R8)

; -------------------------------------------------------
; アドレスブレイク解除（11h）
; @return R2 - HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_addr_break_clr:
	MOV	R11, R8
	DECT	R10
	MOV	R7, (R10)
	DECT	R10
	MOV	R6, (R10)

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_clr_fail
	MOV	R3, R6
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

	LI	R1, #IO_BREAK_SLOT
	SWPB	R6
	MOVB	R6, (R1)
	SWPB	R6
	LI	R0, #0
	SWPB	R0
	LI	R1, #IO_BREAK_CTRL
	MOVB	R0, (R1)			; ENA=0（他ビットも 0）

	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	JMP	l_ab_clr_ret

l_ab_clr_bad:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
	JMP	l_ab_clr_ret

l_ab_clr_fail:
	LI	R2, #HSHK_NG

l_ab_clr_ret:
	MOV	(R10)+, R6
	MOV	(R10)+, R7
	B	(R8)

; -------------------------------------------------------
; 表クリア（リセット後用）
; -------------------------------------------------------
g_hshk_addr_break_init:
	LI	R2, #GL_HSHK_ADDR_BREAK
	LI	R3, #HSHK_AB_TBL_WORDS
l_ab_init_lp:
	CLR	(R2)+
	AI	R3, #-1
	JNE	l_ab_init_lp
	B	(R11)

; -------------------------------------------------------
; BE 2 バイトを 1 ワードにまとめる
; @return R2 - HSHK_OK / HSHK_NG
; @return R3 - 受信ワード（NG 時は 0）
; -------------------------------------------------------
l_ab_recv_word:
	MOV	R11, R9
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_rw_fail
	MOV	R3, R5
	SWPB	R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_ab_rw_fail
	SOC	R3, R5
	MOV	R5, R3
	LI	R2, #HSHK_OK
	B	(R9)
l_ab_rw_fail:
	CLR	R3
	LI	R2, #HSHK_NG
	B	(R9)

; -------------------------------------------------------
; FE80–FE83 へ比較器を書く（表 R7・slot R6 から読む）
; -------------------------------------------------------
l_ab_cru_program:
	MOV	R11, R9

	; FE80: slot
	LI	R1, #IO_BREAK_SLOT
	MOV	R6, R0
	SWPB	R0
	MOVB	R0, (R1)

	; FE81: ENA | MEM/IO | RD/WR（Bit3–6）
	LI	R0, #IO_BREAK_CTRL_ENA
	MOV	2(R7), R1		; flags
	MOV	R1, R2
	ANDI	R2, #HSHK_AB_F_IO
	JEQ	l_ab_mm_rdwr
	ORI	R0, #IO_BREAK_CTRL_IO
l_ab_mm_rdwr:
	SRL	R1, #1
	ANDI	R1, #0x0003
	SLA	R1, #5
	SOC	R1, R0
	SWPB	R0
	LI	R1, #IO_BREAK_CTRL
	MOVB	R0, (R1)

	; FE82–FE83: addr16 BE
	MOV	8(R7), R0		; addr_lo
	SWPB	R0
	LI	R1, #IO_BREAK_ADDR_HI
	MOVB	R0, (R1)			; 上位
	SWPB	R0
	LI	R1, #IO_BREAK_ADDR_LO
	MOVB	R0, (R1)			; 下位 → コミット
	B	(R9)

	.area	_WORK		(REL,NOLOAD)
; スロット 0–3 × 6 語: ena / flags / count / addr_hi / addr_lo / data
GL_HSHK_ADDR_BREAK:	.blkw	HSHK_AB_TBL_WORDS
