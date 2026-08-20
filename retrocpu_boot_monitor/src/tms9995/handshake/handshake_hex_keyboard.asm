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
	MOV	R1, R3
	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_hex_key_fail

	LI	R1, #HSHK_CMD_HEX_KEY
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_hex_key_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_hex_key_fail

	LI	R4, #HSHK_HEX_KEY_COLS
l_hex_key_recv_loop:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_hex_key_recv_fail
	MOV	R1, (R3)
	AI	R3, #2
	AI	R4, #-1
	JNE	l_hex_key_recv_loop

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_hex_key_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R11)

l_hex_key_recv_fail:
	BL	g_hshk_finalize_recv
l_hex_key_fail:
	LI	R1, #HSHK_NG
	B	(R11)
