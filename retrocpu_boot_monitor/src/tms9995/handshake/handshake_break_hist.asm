; ブレイク履歴取得（ハンドシェイク 17h、IO→CPU）
; 受信 1B: slot。ヘッダ 10B + エントリ×件数×78B + 終端 status。
; ヘッダ: count, flags, n_stop, pad0, addr32 BE, histCount, pad0
; スロット不正 → 終端 NG。Bit7 未設定 → 終端 02h。OVF は線上に出さない。
; @return R2 - OK / NG / 02h（履歴モード未設定）

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_break_hist_get
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_bp_send_hist_entries
	.global GL_HSHK_ADDR_BREAK
	.global GL_BP_HIST_META

	.area	_CODE		(REL,CON)
g_hshk_break_hist_get:
	DECT	R10
	MOV	R11, (R10)
	DECT	R10
	MOV	R7, (R10)
	DECT	R10
	MOV	R6, (R10)

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_fail
	ANDI	R3, #0x00ff
	MOV	R3, R7			; slot（送信をまたいで保持）

	CI	R7, #HSHK_AB_SLOTS
	JHE	l_bh_bad

	; 表ポインタ = GL_HSHK_ADDR_BREAK + slot*6 語
	MOV	R7, R4
	SLA	R4, #2
	MOV	R7, R5
	SLA	R5, #1
	A	R5, R4
	SLA	R4, #1
	LI	R5, #GL_HSHK_ADDR_BREAK
	A	R4, R5
	MOV	2(R5), R0
	ANDI	R0, #HSHK_AB_F_HIST
	JEQ	l_bh_nohist

	; メタ件数
	MOV	R7, R0
	SLA	R0, #1
	A	R7, R0
	SLA	R0, #1
	AI	R0, #GL_BP_HIST_META
	MOV	R0, R1
	MOV	0(R1), R6
	CI	R6, #HSHK_BH_DEPTH
	JLE	l_bh_cnt_ok
	LI	R6, #HSHK_BH_DEPTH
l_bh_cnt_ok:
	LI	R8, #HSHK_OK
	BL	l_bh_send_hdr
	CI	R2, #HSHK_OK
	JNE	l_bh_fail
	MOV	R7, R2			; slot
	MOV	R6, R3			; 件数
	BL	g_bp_send_hist_entries
	CI	R2, #HSHK_OK
	JNE	l_bh_fail
	JMP	l_bh_fin

l_bh_nohist:
	CLR	R6
	LI	R8, #HSHK_NG_OTHER
	BL	l_bh_send_hdr
	JMP	l_bh_fin

l_bh_bad:
	CLR	R5
	CLR	R6
	LI	R8, #HSHK_NG
	BL	l_bh_send_hdr
	JMP	l_bh_fin

l_bh_fail:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
	LI	R2, #HSHK_NG
	JMP	l_bh_ret

l_bh_fin:
	MOV	R8, R2
	BL	g_hshk_send_byte
	MOV	R8, R2

l_bh_ret:
	MOV	(R10)+, R6
	MOV	(R10)+, R7
	MOV	(R10)+, R11
	B	(R11)

; R5=表ポインタ（bad 時は 0）、R6=件数、R8=終端
; ヘッダ: count, flags, n_stop, pad0, addr32 BE, histCount(=count), pad0
; @return R2 - 最後の send ステータス
l_bh_send_hdr:
	DECT	R10
	MOV	R11, (R10)
	MOV	R6, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret

	MOV	R5, R5
	JEQ	l_bh_hdr_zeros
	MOV	2(R5), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	4(R5), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	6(R5), R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	8(R5), R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	JMP	l_bh_hdr_hist

l_bh_hdr_zeros:
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret

l_bh_hdr_hist:
	MOV	R6, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R2
	BL	g_hshk_send_byte
l_bh_hdr_ret:
	MOV	(R10)+, R11
	B	(R11)
