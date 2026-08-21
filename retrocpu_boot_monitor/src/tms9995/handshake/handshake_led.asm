; LED表示依頼（ハンドシェイク 16h）
; 線上 送信 16B: 16h, pad(00) + 14 バイト（バッファ各語の下位 8bit）→ 受信 1B: status
; @param R2 - バッファ先頭（14 ワード）
; @return R2 - OK/モードエラー/その他
; seven_seg / bullet は OK スタブ

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_led_display_
	.global g_bios_led_seven_seg
	.global g_bios_led_bullet
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)
g_bios_led_display_:
	MOV	R11, R8
	MOV	R2, R5

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	LI	R2, #HSHK_CMD_LED_DISPLAY
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	LI	R4, #HSHK_LED_DATA_LEN
l_led_send_lp:
	MOV	(R5), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_led_fail
	AI	R5, #2
	AI	R4, #-1
	JNE	l_led_send_lp

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_led_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	B	(R8)

l_led_recv_fail:
	BL	g_hshk_finalize_recv
l_led_fail:
	LI	R2, #HSHK_NG_OTHER
	B	(R8)

g_bios_led_seven_seg:
	LI	R2, #HSHK_OK
	B	(R11)

g_bios_led_bullet:
	LI	R2, #HSHK_OK
	B	(R11)
