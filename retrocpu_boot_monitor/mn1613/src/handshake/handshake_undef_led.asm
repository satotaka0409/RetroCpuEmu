; handshake_undef_led.asm
; 未定義命令LED（ハンドシェイク 13h）
; 根拠: HandShake.mdc「未定義命令LED」/ boot_monitor.mdc
;
; 線上 送信 2B: 13h, Bit0(0=消灯 / 1=点灯) → 受信 1B: status
; モード不問。INT0（未定義命令）から点灯、RST 等で消灯する想定。
;
; 引数は第1=R0（asm-rules.mdc の呼び出し規約）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bios_undef_led
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; 未定義命令LED 点灯/消灯（13h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @note 呼び出しは BALD、戻りは RET（asm-rules.mdc: g_*）
; @param R0 - Bit0: 0=消灯 / 1=点灯（他ビットは無視して Bit0 のみ送る）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_undef_led:
	push	R3
	push	R4
	mv	R2, R0
	andi	R2, #0x0001

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	mvwi	R0, #HSHK_CMD_UNDEF_LED
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	mv	R0, R2
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_undef_led_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_undef_led_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_undef_led_done

l_undef_led_recv_fail:
	bald	g_hshk_finalize_recv
l_undef_led_fail:
	mvwi	R0, #HSHK_NG
l_undef_led_done:
	pop	R4
	pop	R3
	ret