; LCD制御（ハンドシェイク 17h）
; 線上 送信 5B: 17h, kind, argA, argB, argC → 受信 1B: status
; param R1 種別
; param R2 引数A
; param R3 Bit8-9=行 / Bit0-7=列（SetCursor）
; return R1 OK/NG/その他

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
	MOV	R11, R9
	MOV	R1, R4
	ANDI	R4, #0x00ff
	MOV	R2, R5
	ANDI	R5, #0x00ff
	MOV	R3, R6
	MOV	R6, R7
	SWPB	R7
	ANDI	R7, #0x0003
	ANDI	R6, #0x00ff

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	LI	R1, #HSHK_CMD_LCD_CTRL
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R4, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R5, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R7, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	MOV	R6, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_lcd1_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_lcd1_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_lcd1_recv_fail:
	BL	g_hshk_finalize_recv
l_lcd1_fail:
	LI	R1, #HSHK_NG
	B	(R9)
