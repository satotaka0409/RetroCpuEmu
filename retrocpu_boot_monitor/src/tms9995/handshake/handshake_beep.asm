; BEEP音（ハンドシェイク 19h）
; 線上 送信 6B: 19h, freqH, freqL, durH, durL, pad0 → 受信 1B: status
; param R1 周波数 Hz（0=停止）
; param R2 長さ ms（0=無限）
; return R1 OK/NG

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
	MOV	R11, R9
	MOV	R1, R4
	MOV	R2, R5

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	LI	R1, #HSHK_CMD_BEEP
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	MOV	R4, R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail
	MOV	R4, R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	MOV	R5, R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail
	MOV	R5, R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_beep_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_beep_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_beep_recv_fail:
	BL	g_hshk_finalize_recv
l_beep_fail:
	LI	R1, #HSHK_NG
	B	(R9)
