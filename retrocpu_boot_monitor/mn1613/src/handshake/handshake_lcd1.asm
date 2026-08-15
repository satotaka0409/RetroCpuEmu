; handshake_lcd1.asm
; LCD制御（ハンドシェイク 17h）
; 根拠: HandShake.mdc「LCD制御」/ boot_monitor.mdc
;
; 線上 送信 5B: 17h, kind, argA, argB, argC → 受信 1B: status
; モード制約なし（モニター/フリー共通）。
;
; 引数は第1=R0、第2=R1、第3=R2。argC は R3 を使う。
; R3-R4 は非破壊（R0-R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; 送信フレームはスタック上に確保する（_WORK は使わない）。
; 応答は REQ_1 ポーリングで受け取る。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bios_lcd_control
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

BIOS_LCD1_FRAME_LEN	.equ	5

; -------------------------------------------------------
; LCD制御（17h）
; @param R0 - 種別（0:Clear 1:Home 2:DisplayCtrl 3:SetCursor）
; @param R1 - 引数A（DisplayCtrl: Bit0=DisplayOn Bit1=CursorOn Bit2=Blink）
; @param R2 - 引数B（SetCursor: 行 0/1）
; @param R3 - 引数C（SetCursor: 列 0-15）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG / HSHK_NG_OTHER）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_lcd_control:
	push	R3
	push	R4

	si	SP, #BIOS_LCD1_FRAME_LEN

	; X0=R3 なので、退避した argC を SP+7 から拾ってからフレームを組む
	mv	X0, SP
	l	R4, 7(X0)
	andi	R4, #0x00ff
	st	R4, 5(X0)
	mvwi	R4, #HSHK_CMD_LCD_CTRL
	st	R4, 1(X0)
	andi	R0, #0x00ff
	st	R0, 2(X0)
	andi	R1, #0x00ff
	st	R1, 3(X0)
	andi	R2, #0x00ff
	st	R2, 4(X0)

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd1_fail

	mv	X0, SP
	ai	X0, #1
	mvwi	X1, #BIOS_LCD1_FRAME_LEN
l_bios_lcd1_send_lp:
	mv	R2, X0
	l	R0, 0(X0)
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd1_fail
	mv	X0, R2
	ai	X0, #1
	si	X1, #1, Z
	b	l_bios_lcd1_send_lp

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd1_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd1_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd1_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bios_lcd1_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_bios_lcd1_done

l_bios_lcd1_recv_fail:
	bald	g_hshk_finalize_recv
l_bios_lcd1_fail:
	mvwi	R0, #HSHK_NG
l_bios_lcd1_done:
	ai	SP, #BIOS_LCD1_FRAME_LEN
	pop	R4
	pop	R3
	ret
