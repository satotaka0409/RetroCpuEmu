; モード設定（ハンドシェイク 10h）
; 線上 送信 2B: 10h, mode → 受信 1B: status
; @param R2 - モード（0=モニター / 1=フリー）
; @return R2 - OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_mode_set_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_mode_set_:
	MOV	R11, R8
	MOV	R2, R4
	ANDI	R4, #0x00ff

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	LI	R2, #HSHK_CMD_MODE_SET
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	MOV	R4, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_mode_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_mode_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	B	(R8)

l_mode_recv_fail:
	BL	g_hshk_finalize_recv
l_mode_fail:
	LI	R2, #HSHK_NG
	B	(R8)
