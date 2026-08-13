; handshake_chg_mode.asm
; モード設定（ハンドシェイク 10h）
; 根拠: HandShake.mdc「モード設定」/ boot_monitor.mdc
;
; 線上 送信 2B: 10h, mode → 受信 1B: status
; mode 0=モニター / 1=フリー。LED・16進キーはフリー必須。
;
; 引数は第1=R0（asm-rules.mdc の呼び出し規約）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bios_mode_set
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; モード設定（10h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - モード（0=モニター / 1=フリー）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_mode_set:
	push	R3
	push	R4
	mv	R2, R0
	andi	R2, #0x00ff

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	mvwi	R0, #HSHK_CMD_MODE_SET
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	mv	R0, R2
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_mode_set_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_mode_set_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_mode_set_done

l_mode_set_recv_fail:
	bald	g_hshk_finalize_recv
l_mode_set_fail:
	mvwi	R0, #HSHK_NG
l_mode_set_done:
	pop	R4
	pop	R3
	ret