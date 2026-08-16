; handshake_lcd2.asm
; LCD文字列表示（ハンドシェイク 18h）
; 根拠: HandShake.mdc「LCD文字列表示」/ boot_monitor.mdc
;
; 線上 送信 20B: 18h, row, col, len, ch0..ch15 → 受信 1B: status
; モード制約なし（モニター/フリー共通）。
;
; 引数は第1=R0（行・列）、第2=R1（文字数）、第3=R2（文字列先頭）。
; len が 16 未満の残りは空白 (0x20) で埋める。
; R3-R4 は非破壊（R0-R2 は破壊可／戻り可）。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_lcd_text
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

BIOS_LCD2_FRAME_LEN	.equ	20

; -------------------------------------------------------
; LCD文字列表示（18h）
; @param R0 Bit0-7 - 開始列（0-15）
; @param R0 Bit8-9 - 開始行（0:1行目 / 1:2行目）
; @param R1 - 文字数（0-16）
; @param R2 - 文字列先頭（1ワード1バイト）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG / HSHK_NG_OTHER）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_lcd_text:
	push	R3
	push	R4
	push	R2

	si	SP, #10
	si	SP, #10

	mv	X0, SP
	mvwi	R4, #HSHK_CMD_LCD_TEXT
	st	R4, 1(X0)
	; 行 = R0 Bit8-9
	bswp	R4, R0
	andi	R4, #0x0003
	st	R4, 2(X0)
	; 列 = R0 Bit0-7
	andi	R0, #0x00ff
	st	R0, 3(X0)
	andi	R1, #0x00ff
	st	R1, 4(X0)
	mv	R2, R1

	; ch0..ch15 を空白で初期化（0x20）
	; R4=X1 なので空白値は R0、カウンタは R1、書き先だけ X1
	mvwi	R0, #0x20
	mv	X1, SP
	ai	X1, #4
	mvwi	R1, #HSHK_LCD_TEXT_MAX
l_bios_lcd2_fill_space:
	st	R0, 1(X1)
	ai	X1, #1
	si	R1, #1, Z
	b	l_bios_lcd2_fill_space

	; min(len, 16) 文字だけコピー
	; 文字列先頭は退避した SP+21。カウンタは R1（X1 を潰さない）
	mv	X0, SP
	l	R4, 21(X0)
	mv	X0, R4
	mv	X1, SP
	ai	X1, #5
	mvwi	R1, #HSHK_LCD_TEXT_MAX
l_bios_lcd2_copy_lp:
	mv	R0, R2, Z
	b	l_bios_lcd2_copy_do
	b	l_bios_lcd2_copy_done
l_bios_lcd2_copy_do:
	l	R0, 0(X0)
	andi	R0, #0x00ff
	st	R0, 0(X1)
	ai	X0, #1
	ai	X1, #1
	si	R2, #1
	si	R1, #1, Z
	b	l_bios_lcd2_copy_lp
l_bios_lcd2_copy_done:

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd2_fail

	mv	X0, SP
	ai	X0, #1
	mvwi	X1, #BIOS_LCD2_FRAME_LEN
l_bios_lcd2_send_lp:
	mv	R2, X0
	l	R0, 0(X0)
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd2_fail
	mv	X0, R2
	ai	X0, #1
	si	X1, #1, Z
	b	l_bios_lcd2_send_lp

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd2_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd2_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_lcd2_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bios_lcd2_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_bios_lcd2_done

l_bios_lcd2_recv_fail:
	bald	g_hshk_finalize_recv
l_bios_lcd2_fail:
	mvwi	R0, #HSHK_NG
l_bios_lcd2_done:
	ai	SP, #10
	ai	SP, #10
	pop	R2
	pop	R4
	pop	R3
	ret
