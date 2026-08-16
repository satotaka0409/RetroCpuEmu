; handshake_timer.asm
; タイマー設定（ハンドシェイク 12h）
; 根拠: HandShake.mdc「タイマー設定」/ boot_monitor.mdc「タイマー割り込み」
;
; 線上 送信 6B: 12h, タイマー番号, 周期H, 周期L, 回数H, 回数L → 受信 1B: status
; タイマーは IO ボード側にあり、番号 0 / 1 の 2 本。初期化直後は停止している。
; 周期 0 で停止、回数 0 で無限。
;
; 引数は第1=R0、第2=R1、第3=R2、第4以降はスタック（asm-rules.mdc）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; 送信フレームはスタック上に確保する（_WORK は使わない）。
; g_* は BALD / RET。バッファポインタは必要なら R2 に退避する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_timer_set
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

BIOS_TIMER_FRAME_LEN	.equ	6

; -------------------------------------------------------
; タイマー設定（12h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - タイマー番号（0 または 1）
; @param R1 - 周期 ms（16bit、0 で停止）
; @param R2 - 回数（16bit、0 で無限）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_timer_set:
	push	R3
	push	R4
	; R2 = 回数（第3引数。PUSH 後もレジスタ値は残る）

	; 送信フレーム 6 ワードをスタックに確保（SP+1 … SP+6）
	si	SP, #BIOS_TIMER_FRAME_LEN

	; 1 ワード 1 バイト、上位バイト先
	mv	X0, SP
	mv	R4, R0			; タイマー番号
	mvwi	R0, #HSHK_CMD_TIMER_SET
	st	R0, 1(X0)
	mv	R0, R4
	andi	R0, #0x00ff
	st	R0, 2(X0)
	bswp	R0, R1
	andi	R0, #0x00ff
	st	R0, 3(X0)
	mv	R0, R1
	andi	R0, #0x00ff
	st	R0, 4(X0)
	bswp	R0, R2			; R2 = 回数
	andi	R0, #0x00ff
	st	R0, 5(X0)
	mv	R0, R2
	andi	R0, #0x00ff
	st	R0, 6(X0)

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_timer_fail

	mv	X0, SP
	ai	X0, #1			; フレーム先頭
	mvwi	X1, #BIOS_TIMER_FRAME_LEN
l_bios_timer_send_lp:
	mv	R2, X0			; send_byte 前後で退避
	l	R0, 0(X0)
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_timer_fail
	mv	X0, R2
	ai	X0, #1
	si	X1, #1, Z
	b	l_bios_timer_send_lp

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_timer_fail

	; 応答 1 バイトは IO→CPU の転送で届く。割り込みを待たず REQ_1 をポーリングする
	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_timer_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_bios_timer_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bios_timer_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_bios_timer_done

l_bios_timer_recv_fail:
	bald	g_hshk_finalize_recv
l_bios_timer_fail:
	mvwi	R0, #HSHK_NG
l_bios_timer_done:
	ai	SP, #BIOS_TIMER_FRAME_LEN
	pop	R4
	pop	R3
	ret