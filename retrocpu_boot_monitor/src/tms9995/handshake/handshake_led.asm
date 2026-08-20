; LED表示依頼（ハンドシェイク 16h）
; 線上 送信 15B: 16h + 14 バイト（バッファ各語の下位 8bit）→ 受信 1B: status
; param R1 バッファ先頭（14 ワード）
; return R1 OK/モードエラー/その他
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
	MOV	R11, R9
	MOV	R1, R3

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_led_fail

	LI	R1, #HSHK_CMD_LED_DISPLAY
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_led_fail

	LI	R4, #HSHK_LED_DATA_LEN
l_led_send_lp:
	MOV	(R3), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_led_fail
	AI	R3, #2
	AI	R4, #-1
	JNE	l_led_send_lp

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_led_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_led_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_led_recv_fail:
	BL	g_hshk_finalize_recv
l_led_fail:
	LI	R1, #HSHK_NG_OTHER
	B	(R9)

g_bios_led_seven_seg:
	LI	R1, #HSHK_OK
	B	(R11)

g_bios_led_bullet:
	LI	R1, #HSHK_OK
	B	(R11)
