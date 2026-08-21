; 未定義命令実行通知（ハンドシェイク 13h）
; 線上 送信 70B: 13h + pad + addr32 + R0–R15 + stack16語 → 受信 1B: status
; 割り込み WP の R13/R14（旧 WP / 旧 PC）から本体を送る。
; @return R2 - OK/NG

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
	.global g_bp_send_user_state_body
	.global g_bp_copy_user_regs
	.global GL_UNDEF_INST_REG

	.area	_CODE		(REL,CON)
g_bios_undef_led:
	MOV	R11, R8

	; 旧 WP を GL_UNDEF_INST_REG へ退避（デバッグ／再送用）
	MOV	R13, R2
	LI	R3, #GL_UNDEF_INST_REG
	BL	g_bp_copy_user_regs

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	LI	R2, #HSHK_CMD_UNDEF_LED
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	BL	g_bp_send_user_state_body
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_undef_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_undef_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	B	(R8)

l_undef_recv_fail:
	BL	g_hshk_finalize_recv
l_undef_fail:
	LI	R2, #HSHK_NG
	B	(R8)
