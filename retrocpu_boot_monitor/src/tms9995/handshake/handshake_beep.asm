; BEEP音（ハンドシェイク 19h）
; 線上 送信 6B: 19h, freqH, freqL, durH, durL, pad0 → 受信 1B: status
; @param R2 - 周波数 Hz（0=停止）
; @param R3 - 長さ ms（0=無限）
; @return R2 - OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_beep_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_beep_:
	MOV	R11, R8
	MOV	R4, R2
	MOV	R5, R3

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	LI	R2, #HSHK_CMD_BEEP
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	MOV	R4, R2
	SWPB	R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail
	MOV	R4, R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	MOV	R5, R2
	SWPB	R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail
	MOV	R5, R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	B	(R8)

l_beep_recv_fail:
	BL	g_hshk_finalize_recv
l_beep_fail:
	LI	R2, #HSHK_NG
	B	(R8)
