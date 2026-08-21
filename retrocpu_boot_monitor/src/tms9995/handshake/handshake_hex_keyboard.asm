; 16進キー入力取得（ハンドシェイク 14h）
; 線上 送信 1B: 14h → 受信 9B: col0..col7 + status
; @param R2 - 結果バッファ先頭（8 ワード、各列 下位 8bit）
; @return R2 - OK / 01h モードエラー / 02h その他

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_hex_key_get_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_hex_key_get_:
	MOV	R11, R8
	MOV	R2, R5
	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_hex_key_fail

	LI	R2, #HSHK_CMD_HEX_KEY
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_hex_key_fail

	LI	R4, #HSHK_HEX_KEY_COLS
l_hex_key_recv_loop:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_hex_key_recv_fail
	MOV	R3, (R5)
	AI	R5, #2
	AI	R4, #-1
	JNE	l_hex_key_recv_loop

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_hex_key_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	B	(R8)

l_hex_key_recv_fail:
	BL	g_hshk_finalize_recv
l_hex_key_fail:
	LI	R2, #HSHK_NG
	B	(R8)
