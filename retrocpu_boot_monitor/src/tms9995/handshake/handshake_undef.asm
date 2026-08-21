; 未定義命令実行通知（ハンドシェイク 13h）
; 線上 送信 70B: 13h + (pad + addr32 + regs + pad + stack16語) → 受信 1B: status
; TMS9995 CPU 実行コンテキスト未実装のため、通知本体 69B はゼロ埋めで送る。
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

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	LI	R1, #HSHK_CMD_UNDEF_LED
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_undef_fail

	LI	R7, #69
l_undef_body_lp:
	MOV	R7, R7
	JEQ	l_undef_body_done
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_undef_fail
	AI	R7, #-1
	JMP	l_undef_body_lp
l_undef_body_done:

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
