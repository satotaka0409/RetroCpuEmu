; handshake_beep.asm
; BEEP音（ハンドシェイク 19h）
; 根拠: HandShake.mdc「BEEP音」/ boot_monitor.mdc
;
; 線上 送信 5B: 19h, freqH, freqL, durH, durL → 受信 1B: status
; 周波数 0 で停止、長さ 0 で無限。モード不問。
;
; 引数は第1=R0、第2=R1（asm-rules.mdc の呼び出し規約）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; 送信フレームはスタック上に確保する（_WORK は使わない）。
; g_* は BALD / RET。バッファポインタは必要なら R2 に退避する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_beep_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

BIOS_BEEP_FRAME_LEN	.equ	5

; -------------------------------------------------------
; BEEP音（19h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - 周波数 Hz（16bit、0 で停止）
; @param R1 - 長さ ms（16bit、0 で無限）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_beep_:
	push	R3
	push	R4

	si	SP, #BIOS_BEEP_FRAME_LEN

	mv	X0, SP
	mv	R2, R0			; 周波数
	mvwi	R0, #HSHK_CMD_BEEP
	st	R0, 1(X0)
	bswp	R0, R2
	andi	R0, #0x00ff
	st	R0, 2(X0)
	mv	R0, R2
	andi	R0, #0x00ff
	st	R0, 3(X0)
	bswp	R0, R1			; 長さ
	andi	R0, #0x00ff
	st	R0, 4(X0)
	mv	R0, R1
	andi	R0, #0x00ff
	st	R0, 5(X0)

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_beep_fail

	mv	X0, SP
	ai	X0, #1
	mvwi	X1, #BIOS_BEEP_FRAME_LEN
l_bios_beep_send_lp:
	mv	R2, X0
	l	R0, 0(X0)
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_beep_fail
	mv	X0, R2
	ai	X0, #1
	si	X1, #1, Z
	b	l_bios_beep_send_lp

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_beep_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_beep_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_beep_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bios_beep_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_bios_beep_done

l_bios_beep_recv_fail:
	bald	g_hshk_finalize_recv
l_bios_beep_fail:
	mvwi	R0, #HSHK_NG
l_bios_beep_done:
	ai	SP, #BIOS_BEEP_FRAME_LEN
	pop	R4
	pop	R3
	ret