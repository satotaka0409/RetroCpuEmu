; LCD制御（ハンドシェイク 17h）
; 線上 送信 6B: 17h, pad(00), kind, argA, argB, argC → 受信 1B: status
; @param R2 - 種別
; @param R3 - 引数A
; @param R4 - Bit8-9=行 / Bit0-7=列（SetCursor）
; @return R2 - OK/NG/その他
; 送信をまたぐ値は R4/R5/R8（R6/R7/R9 は呼び出し元のもの）。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_lcd_control_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_lcd_control_:
	DECT	R10
	MOV	R11, (R10)
	MOV	R4, R8			; 行・列（パック）
	MOV	R2, R4
	ANDI	R4, #0x00ff		; kind
	MOV	R3, R5
	ANDI	R5, #0x00ff		; argA

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	LI	R2, #HSHK_CMD_LCD_CTRL
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R4, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R5, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R8, R2			; 行
	SWPB	R2
	ANDI	R2, #0x0003
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R8, R2			; 列
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	(R10)+, R11
	B	(R11)

l_lcd1_recv_fail:
	BL	g_hshk_finalize_recv
l_lcd1_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)
