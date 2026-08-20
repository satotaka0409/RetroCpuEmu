; ブレイク履歴取得（ハンドシェイク 17h、IO→CPU）・最小フレーミング
; 受信 2B: slot, flags。件数 0 のヘッダ 8B + 終端 status。
; スロット不正 → 終端 NG。Bit7 未設定 → 終端 02h。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_break_hist_get
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global GL_HSHK_ADDR_BREAK

	.area	_CODE		(REL,CON)
g_hshk_break_hist_get:
	MOV	R11, R9

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_fail
	ANDI	R1, #0x00ff
	MOV	R1, R3

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_bh_fail

	CI	R3, #HSHK_AB_SLOTS
	JHE	l_bh_bad

	; 表ポインタ = GL_HSHK_ADDR_BREAK + slot*6 語
	MOV	R3, R4
	SLA	R4, #2
	MOV	R3, R5
	SLA	R5, #1
	A	R5, R4
	SLA	R4, #1
	LI	R5, #GL_HSHK_ADDR_BREAK
	A	R4, R5
	MOV	2(R5), R0
	ANDI	R0, #HSHK_AB_F_HIST
	JEQ	l_bh_nohist

	; 履歴あり・件数 0（最小）
	CLR	R6
	CLR	R7
	LI	R8, #HSHK_OK
	BL	l_bh_send_hdr
	JMP	l_bh_fin

l_bh_nohist:
	CLR	R6
	LI	R7, #HSHK_BH_ST_NOHIST
	LI	R8, #HSHK_NG_OTHER
	BL	l_bh_send_hdr
	JMP	l_bh_fin

l_bh_bad:
	CLR	R5
	CLR	R6
	CLR	R7
	LI	R8, #HSHK_NG
	BL	l_bh_send_hdr
	JMP	l_bh_fin

l_bh_fail:
	LI	R1, #HSHK_NG
	BL	g_hshk_send_byte
	LI	R1, #HSHK_NG
	B	(R9)

l_bh_fin:
	MOV	R8, R1
	BL	g_hshk_send_byte
	MOV	R8, R1
	B	(R9)

; R5=表ポインタ（bad 時は 0）、R6=件数、R7=線上ステータス、R8=終端
; ヘッダ: count, status, flags, n_stop, addr32 BE
; send_byte が R0/R4 を潰すので戻りは R10 スタックへ
l_bh_send_hdr:
	DECT	R10
	MOV	R11, (R10)
	MOV	R6, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret

	MOV	R7, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret

	MOV	R5, R5
	JEQ	l_bh_hdr_zeros
	MOV	2(R5), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	4(R5), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	6(R5), R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	6(R5), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	8(R5), R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	MOV	8(R5), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	JMP	l_bh_hdr_ret

l_bh_hdr_zeros:
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bh_hdr_ret
	CLR	R1
	BL	g_hshk_send_byte
l_bh_hdr_ret:
	MOV	(R10)+, R11
	B	(R11)
