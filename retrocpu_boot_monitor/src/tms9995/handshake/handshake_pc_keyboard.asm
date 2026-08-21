; PCキー入力取得（ハンドシェイク 15h）
; 線上 送信 2B: 15h, pad(00) → 受信 3B: ascii, keyCode, status
; return R1 status、R2 ASCII、R3 キーコード（失敗時 R2=R3=0）

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_pc_key_get_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_pc_key_get_:
	MOV	R11, R9

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	LI	R1, #HSHK_CMD_PC_KEY
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	ANDI	R1, #0x00ff
	MOV	R1, R4

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	ANDI	R1, #0x00ff
	MOV	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	MOV	R1, R6
	BL	g_hshk_finalize_recv
	MOV	R6, R1
	ANDI	R1, #0x00ff
	MOV	R4, R2
	MOV	R5, R3
	B	(R9)

l_pckey_recv_fail:
	BL	g_hshk_finalize_recv
l_pckey_fail:
	LI	R1, #HSHK_NG
	CLR	R2
	CLR	R3
	B	(R9)
