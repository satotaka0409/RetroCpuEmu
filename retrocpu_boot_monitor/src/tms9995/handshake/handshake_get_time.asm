; 時刻取得（ハンドシェイク 11h）
; 線上 送信 1B: 11h → 受信 9B: 時刻7..0 + status
; param R1 バッファ先頭（4 ワード、各 BE ペア）
; return R1 OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_get_time_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_hshk_get_time_:
	MOV	R11, R9
	MOV	R1, R3

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_time_fail

	LI	R1, #HSHK_CMD_GET_TIME
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_time_fail

	LI	R4, #4
l_time_recv_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5
	MOV	R5, (R3)
	AI	R3, #2
	AI	R4, #-1
	JNE	l_time_recv_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_time_recv_fail:
	BL	g_hshk_finalize_recv
l_time_fail:
	LI	R1, #HSHK_NG
	B	(R9)
