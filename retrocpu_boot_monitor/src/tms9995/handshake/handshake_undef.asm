; 未定義命令 LED（ハンドシェイク 13h・簡易）
; 線上 送信 2B: 13h, flag(Bit0) → 受信 1B: status
; param R1 Bit0 0=消灯 / 1=点灯
; return R1 OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_undef_led
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_undef_led:
	MOV	R11, R9
	MOV	R1, R4
	ANDI	R4, #0x0001

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	LI	R1, #HSHK_CMD_UNDEF_LED
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	MOV	R4, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_undef_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_undef_recv_fail:
	BL	g_hshk_finalize_recv
l_undef_fail:
	LI	R1, #HSHK_NG
	B	(R9)
