; LCD文字列表示（ハンドシェイク 18h・簡易）
; 線上 送信 20B: 18h, row, col, len, ch0..ch15(0) → 受信 1B: status
; param R1 Bit8-9=行 / Bit0-7=列
; param R2 文字数（0-16）
; param R3 バッファ（未使用・文字は 0 埋め）
; return R1 OK/NG

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
	MOV	R11, R9
	MOV	R1, R7
	MOV	R7, R5
	SWPB	R5
	ANDI	R5, #0x0003
	MOV	R7, R4
	ANDI	R4, #0x00ff
	MOV	R2, R6
	ANDI	R6, #0x00ff
	CI	R6, #HSHK_LCD_TEXT_MAX
	JLE	l_lcd2_len_ok
	LI	R6, #HSHK_LCD_TEXT_MAX
l_lcd2_len_ok:

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	LI	R1, #HSHK_CMD_LCD_TEXT
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R5, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R4, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	MOV	R6, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	LI	R7, #HSHK_LCD_TEXT_MAX
l_lcd2_ch_lp:
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail
	AI	R7, #-1
	JNE	l_lcd2_ch_lp

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_lcd2_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd2_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_lcd2_recv_fail:
	BL	g_hshk_finalize_recv
l_lcd2_fail:
	LI	R1, #HSHK_NG
	B	(R9)
