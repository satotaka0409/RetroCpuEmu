; 時刻取得（ハンドシェイク 11h）
; 線上 送信 1B: 11h → 受信 9B: 時刻7..0 + status
; @param R2 - バッファ先頭（4 ワード、各 BE ペア）
; @return R2 - OK/NG
; 破壊は R2–R5 のみ（R6–R9 を保つ。IRQ 中の g_bp_hist_append から呼ぶため）

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
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R5

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_time_fail

	LI	R2, #HSHK_CMD_GET_TIME
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_time_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_time_fail

	LI	R4, #4
l_time_recv_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, (R5)
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	SOC	R3, (R5)
	AI	R5, #2
	AI	R4, #-1
	JNE	l_time_recv_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_time_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	(R10)+, R11
	B	(R11)

l_time_recv_fail:
	BL	g_hshk_finalize_recv
l_time_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)
