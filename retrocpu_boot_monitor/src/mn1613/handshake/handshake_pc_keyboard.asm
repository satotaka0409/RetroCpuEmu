; handshake_pc_keyboard.asm
; PCキー入力取得（ハンドシェイク 15h）
; 根拠: HandShake.mdc「PCキー入力取得」/ boot_monitor.mdc / asm-rules.mdc
;
; 線上 送信 2B: 15h, pad(00) → 受信 3B: ascii, keyCode, status
; モード不問。未入力時は ASCII/コードとも 0、status=OK もあり得る。
;
; 戻り: R0=OK/NG、R1=ASCII（下位 8bit）、R2=キーコード（下位 8bit）。
; 失敗時は R0=NG、R1=0、R2=0。スタックバッファは使わない。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）。
; g_* は BALD / RET。ASCII/keycode はスタック退避。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_pc_key_get_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; PCキー入力取得（15h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @return R0 - OK / NG
; @return R1 - ASCII（下位 8bit）
; @return R2 - キーコード（下位 8bit）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_pc_key_get_:
	push	R3
	push	R4

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_pc_key_fail

	mvwi	R0, #HSHK_CMD_PC_KEY
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_pc_key_fail

	eor	R0, R0
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_pc_key_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_pc_key_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_pc_key_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_pc_key_recv_fail
	andi	R1, #0x00ff
	push	R1			; ASCII

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_pc_key_recv_fail_a
	andi	R1, #0x00ff
	push	R1			; keycode

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_pc_key_recv_fail_ak

	mv	R2, R1			; status 一時
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	pop	R2			; keycode
	andi	R2, #0x00ff
	pop	R1			; ASCII
	andi	R1, #0x00ff
	b	l_pc_key_done

l_pc_key_recv_fail_ak:
	pop	R1			; keycode 捨て
l_pc_key_recv_fail_a:
	pop	R1			; ASCII 捨て
l_pc_key_recv_fail:
	bald	g_hshk_finalize_recv
l_pc_key_fail:
	mvwi	R0, #HSHK_NG
	eor	R1, R1
	eor	R2, R2
l_pc_key_done:
	pop	R4
	pop	R3
	ret