; breakpoint_hist.asm
; 比較器ヒット履歴 1 件追記（平アドレス HSHK_BH_BASE）
; 根拠: HandShake.mdc 17h エントリ / handshake_io.inc
;
; エントリは時刻・レジスタを 0 埋め（IRQ 中の get_time は省略）。
; param R0 スロット 0–3
; 呼び出し: BL / B (R11)

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_bp_hist_append
	.global GL_BP_HIST_META

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; リングへ 1 件（39 語 = 78B）を 0 で書き、メタを進める
; param R0 slot
; -------------------------------------------------------
g_bp_hist_append:
	MOV	R11, R8
	MOV	R0, R3			; slot
	ANDI	R3, #0x0003

	; R4 = &GL_BP_HIST_META[slot]（slot*6 バイト）
	MOV	R3, R1
	SLA	R1, #1			; *2
	A	R3, R1			; *3 words
	SLA	R1, #1			; bytes
	AI	R1, #GL_BP_HIST_META
	MOV	R1, R4

	MOV	2(R4), R5		; next index

	; dest = BASE + slot*312 + next*78（バイト）
	; slot*312 = slot<<8 + slot<<5 + slot<<4 + slot<<3
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
	; next*78 = next<<6 + next<<3 + next<<2 + next<<1
	MOV	R5, R1
	SLA	R1, #6
	MOV	R5, R2
	SLA	R2, #3
	A	R2, R1
	MOV	R5, R2
	SLA	R2, #2
	A	R2, R1
	MOV	R5, R2
	SLA	R2, #1
	A	R2, R1
	A	R1, R0
	AI	R0, #HSHK_BH_BASE
	MOV	R0, R10			; dest（R6/R7 は呼び出し側の slot/表）

	LI	R1, #HSHK_BH_ENTRY_WORDS
l_ha_z:
	CLR	(R10)+
	AI	R1, #-1
	JNE	l_ha_z

	; count++（上限 DEPTH）
	MOV	0(R4), R0
	CI	R0, #HSHK_BH_DEPTH
	JHE	l_ha_ovf
	AI	R0, #1
	MOV	R0, 0(R4)
	JMP	l_ha_adv
l_ha_ovf:
	LI	R0, #1
	MOV	R0, 4(R4)		; overflow flag

l_ha_adv:
	MOV	R5, R0
	AI	R0, #1
	CI	R0, #HSHK_BH_DEPTH
	JL	l_ha_store_next
	CLR	R0
	LI	R1, #1
	MOV	R1, 4(R4)
l_ha_store_next:
	MOV	R0, 2(R4)
	B	(R8)

	.area	_WORK		(REL,NOLOAD)
; スロット 0–3 × 3 語: count / next / ovf
GL_BP_HIST_META:	.blkw	HSHK_BH_META_TBL
