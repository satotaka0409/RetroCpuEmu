; LCD文字列表示（ハンドシェイク 18h・簡易）
; 線上 送信 20B: 18h, row, col, len, ch0..ch15(0) → 受信 1B: status
; @param R2 - Bit8-9=行 / Bit0-7=列
; @param R3 - 文字数（0-16）
; @param R4 - バッファ（未使用・文字は 0 埋め）
; @return R2 - OK/NG
; 送信をまたぐ値は R4/R5/R8（R6/R7/R9 は呼び出し元のもの）。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_lcd_text_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_lcd_text_:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R8			; 行・列（パック）
	MOV	R3, R4
	ANDI	R4, #0x00ff		; 文字数
	CI	R4, #HSHK_LCD_TEXT_MAX
	JLE	l_lcd2_len_ok
	LI	R4, #HSHK_LCD_TEXT_MAX
l_lcd2_len_ok:

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	LI	R2, #HSHK_CMD_LCD_TEXT
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R8, R2			; 行
	SWPB	R2
	ANDI	R2, #0x0003
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R8, R2			; 列
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R4, R2			; 文字数
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	LI	R5, #HSHK_LCD_TEXT_MAX
l_lcd2_ch_lp:
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail
	AI	R5, #-1
	JNE	l_lcd2_ch_lp

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	(R10)+, R11
	B	(R11)

l_lcd2_recv_fail:
	BL	g_hshk_finalize_recv
l_lcd2_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)
