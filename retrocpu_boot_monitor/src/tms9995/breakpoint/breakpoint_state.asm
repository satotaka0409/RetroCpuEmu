; breakpoint_state.asm
; 1Bh/13h 本体と 1Ah/87h 履歴エントリ送出の共通ルーチン（TMS9995）
; 根拠: HandShake.mdc（1Bh/13h=70B、履歴エントリ 78B）
;
; 割り込み WP 前提: R13=旧 WP、R14=旧 PC、R15=旧 ST（BLWP 退避）。
; ユーザ SP は旧 WP の R10（asm_rules.mdc）。
; 呼出規約: BL / B (R11)。第1引数 R2、ステータス R2。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_bp_send_user_state_body
	.global g_bp_send_hist_entries
	.global g_bp_copy_user_regs
	.global g_hshk_send_byte
	.global g_hshk_send_word

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; 1Bh/13h の cmd 直後 69B を送る
; pad(1) + addr32(4) + R0–R15(32) + stack16語(32)
; 前提: R13=旧 WP、R14=旧 PC（破壊しない）
; @return R2 - HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_bp_send_user_state_body:
	DECT	R10
	MOV	R11, (R10)

	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_sus_fail

	CLR	R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_sus_fail
	MOV	R14, R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_sus_fail

	MOV	R13, R4			; ユーザ WP
	LI	R5, #16
l_sus_reg_lp:
	MOV	(R4)+, R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_sus_fail
	AI	R5, #-1
	JNE	l_sus_reg_lp

	; スタック: ユーザ R10 先頭から 16 語（R10=0 なら 0 埋め）
	MOV	20(R13), R4		; user R10
	LI	R5, #16
	MOV	R4, R4
	JEQ	l_sus_stk_z
l_sus_stk_lp:
	MOV	(R4)+, R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_sus_fail
	AI	R5, #-1
	JNE	l_sus_stk_lp
	JMP	l_sus_ok

l_sus_stk_z:
	CLR	R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_sus_fail
	AI	R5, #-1
	JNE	l_sus_stk_z

l_sus_ok:
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)
l_sus_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)

; -------------------------------------------------------
; 旧 WP から R0–R15 を dest へ 16 語コピー
; @param R2 - コピー元（旧 WP）
; @param R3 - コピー先
; -------------------------------------------------------
g_bp_copy_user_regs:
	LI	R4, #16
l_cur_lp:
	MOV	(R2)+, (R3)+
	AI	R4, #-1
	JNE	l_cur_lp
	B	(R11)

; -------------------------------------------------------
; 履歴エントリを番号順（index 0 から）に件数分送る（各 78B = 39 語 BE）
; @param R2 - slot 0–3
; @param R3 - 件数 0–4
; @return R2 - HSHK_OK / HSHK_NG（件数 0 なら OK）
; -------------------------------------------------------
g_bp_send_hist_entries:
	DECT	R10
	MOV	R11, (R10)
	DECT	R10
	MOV	R9, (R10)
	DECT	R10
	MOV	R7, (R10)
	DECT	R10
	MOV	R6, (R10)

	MOV	R2, R9			; slot（送信をまたいで保持）
	MOV	R3, R5			; 残り件数
	MOV	R5, R5
	JEQ	l_she_ok

	CLR	R4			; index 0 から

l_she_lp:
	MOV	R5, R5
	JEQ	l_she_ok

	; dest = BASE + slot*312 + index*78
	MOV	R9, R0
	SLA	R0, #8
	MOV	R9, R1
	SLA	R1, #5
	A	R1, R0
	MOV	R9, R1
	SLA	R1, #4
	A	R1, R0
	MOV	R9, R1
	SLA	R1, #3
	A	R1, R0
	MOV	R4, R1
	SLA	R1, #6
	MOV	R4, R6
	SLA	R6, #3
	A	R6, R1
	MOV	R4, R6
	SLA	R6, #2
	A	R6, R1
	MOV	R4, R6
	SLA	R6, #1
	A	R6, R1
	A	R1, R0
	AI	R0, #HSHK_BH_BASE
	MOV	R0, R7			; entry ptr

	LI	R6, #HSHK_BH_ENTRY_WORDS
l_she_w:
	MOV	(R7)+, R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_she_fail
	AI	R6, #-1
	JNE	l_she_w

	AI	R4, #1
	ANDI	R4, #HSHK_BH_INDEX_MASK
	AI	R5, #-1
	JMP	l_she_lp

l_she_ok:
	LI	R2, #HSHK_OK
	JMP	l_she_ret
l_she_fail:
	LI	R2, #HSHK_NG
l_she_ret:
	MOV	(R10)+, R6
	MOV	(R10)+, R7
	MOV	(R10)+, R9
	MOV	(R10)+, R11
	B	(R11)
