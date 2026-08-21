; breakpoint_hist.asm
; 比較器ヒット履歴 1 件追記（平アドレス HSHK_BH_BASE）
; 根拠: HandShake.mdc 17h エントリ / handshake_io.inc
;
; 時刻は 11h、レジスタは旧 WP（R13）、スタックはユーザ R10。
; AFTER/PREV は表 flags と監視アドレス／CRU PREV から埋める。
; @param R2 - スロット 0–3
; 呼び出し: BL / B (R11)
; 11h（g_hshk_get_time_）は R2–R5 を壊すので、メタ=R9 / next=R8 / 表=R6 / dest=R7 に置く。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_bp_hist_append
	.global GL_BP_HIST_META
	.global GL_HSHK_ADDR_BREAK
	.global g_hshk_get_time_

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; リングへ 1 件（39 語 = 78B）を書き、メタを進める
; @param R2 - slot
; 前提: R13=旧 WP（破壊しない）
; -------------------------------------------------------
g_bp_hist_append:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R3			; slot
	ANDI	R3, #0x0003

	; R9 = &GL_BP_HIST_META[slot]
	MOV	R3, R1
	SLA	R1, #1
	A	R3, R1
	SLA	R1, #1
	AI	R1, #GL_BP_HIST_META
	MOV	R1, R9

	MOV	2(R9), R8		; next index

	; dest = BASE + slot*312 + next*78
	MOV	R3, R0
	SLA	R0, #8
	MOV	R3, R1
	SLA	R1, #5
	A	R1, R0
	MOV	R3, R1
	SLA	R1, #4
	A	R1, R0
	MOV	R3, R1
	SLA	R1, #3
	A	R1, R0
	MOV	R8, R1
	SLA	R1, #6
	MOV	R8, R2
	SLA	R2, #3
	A	R2, R1
	MOV	R8, R2
	SLA	R2, #2
	A	R2, R1
	MOV	R8, R2
	SLA	R2, #1
	A	R2, R1
	A	R1, R0
	AI	R0, #HSHK_BH_BASE
	MOV	R0, R7			; dest

	; 表ポインタ（AFTER/PREV 用）
	MOV	R3, R0
	SLA	R0, #2
	MOV	R3, R1
	SLA	R1, #1
	A	R1, R0
	SLA	R0, #1
	AI	R0, #GL_HSHK_ADDR_BREAK
	MOV	R0, R6			; 表

	; 時刻 4 語（BUSY を下ろして 11h。失敗時もバッファ内容のまま書く）
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	LI	R2, #GL_BP_TIME_BUF
	BL	g_hshk_get_time_
	LI	R1, #GL_BP_TIME_BUF
	MOV	(R1)+, (R7)+
	MOV	(R1)+, (R7)+
	MOV	(R1)+, (R7)+
	MOV	(R1)+, (R7)+
	LI	R12, #0
	SBO	#INTERRUPT_BUSY_BIT

	; AFTER: IO なら 0、それ以外は addr_lo の現在語
	CLR	R0
	MOV	2(R6), R1		; flags
	ANDI	R1, #HSHK_AB_F_IO
	JNE	l_ha_after_st
	MOV	8(R6), R1		; addr_lo
	MOV	(R1), R0
l_ha_after_st:
	MOV	R0, (R7)+

	; PREV: WR かつ非 INST なら CRU PREV、それ以外は 0
	CLR	R0
	MOV	2(R6), R1
	ANDI	R1, #HSHK_AB_F_INST
	JNE	l_ha_prev_st
	MOV	2(R6), R1
	ANDI	R1, #HSHK_AB_F_WR
	JEQ	l_ha_prev_st
	LI	R12, #IO_BREAK_PREV
	STCR	R0, #8
	ANDI	R0, #0x00ff
l_ha_prev_st:
	MOV	R0, (R7)+

	; R0–R15（旧 WP）
	MOV	R13, R1
	LI	R2, #16
l_ha_reg:
	MOV	(R1)+, (R7)+
	AI	R2, #-1
	JNE	l_ha_reg

	; pad 1 語
	CLR	(R7)+

	; スタック 16 語（ユーザ R10）
	MOV	20(R13), R1
	LI	R2, #16
	MOV	R1, R1
	JEQ	l_ha_stk_z
l_ha_stk:
	MOV	(R1)+, (R7)+
	AI	R2, #-1
	JNE	l_ha_stk
	JMP	l_ha_meta
l_ha_stk_z:
	CLR	(R7)+
	AI	R2, #-1
	JNE	l_ha_stk_z

l_ha_meta:
	; count++（上限 DEPTH）
	MOV	0(R9), R0
	CI	R0, #HSHK_BH_DEPTH
	JHE	l_ha_ovf
	AI	R0, #1
	MOV	R0, 0(R9)
	JMP	l_ha_adv
l_ha_ovf:
	LI	R0, #1
	MOV	R0, 4(R9)

l_ha_adv:
	MOV	R8, R0
	AI	R0, #1
	CI	R0, #HSHK_BH_DEPTH
	JL	l_ha_store_next
	CLR	R0
	LI	R1, #1
	MOV	R1, 4(R9)
l_ha_store_next:
	MOV	R0, 2(R9)
	MOV	(R10)+, R11
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
; スロット 0–3 × 3 語: count / next / ovf
GL_BP_HIST_META:	.blkw	HSHK_BH_META_TBL
; 11h 受信用（IRQ 中のスタック確保を避ける）
GL_BP_TIME_BUF:		.blkw	4
