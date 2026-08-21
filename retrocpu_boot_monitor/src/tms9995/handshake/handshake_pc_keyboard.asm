; PCキー入力取得（ハンドシェイク 15h）
; 線上 送信 2B: 15h, pad(00) → 受信 3B: ascii, keyCode, status
; @return R2 - status
; @return R3 - ASCII（下位 8bit。失敗時 0）
; @return R4 - キーコード（下位 8bit。失敗時 0）

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
	DECT	R10
	MOV	R11, (R10)

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	LI	R2, #HSHK_CMD_PC_KEY
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_pckey_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	ANDI	R3, #0x00ff
	MOV	R3, R4			; ASCII

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	ANDI	R3, #0x00ff
	MOV	R3, R5			; キーコード

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_pckey_recv_fail
	DECT	R10
	MOV	R3, (R10)		; status（finalize をまたぐ）
	BL	g_hshk_finalize_recv
	MOV	(R10)+, R2
	ANDI	R2, #0x00ff
	MOV	R4, R3
	MOV	R5, R4
	MOV	(R10)+, R11
	B	(R11)

l_pckey_recv_fail:
	BL	g_hshk_finalize_recv
l_pckey_fail:
	LI	R2, #HSHK_NG
	CLR	R3
	CLR	R4
	MOV	(R10)+, R11
	B	(R11)
