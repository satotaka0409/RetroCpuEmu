; handshake_timer.asm
; タイマー設定（ハンドシェイク 19h）
; 根拠: HandShake.mdc「タイマー設定」/ boot_monitor.mdc「タイマー割り込み」
;
; 線上 送信 6B: 19h, タイマー番号, 周期H, 周期L, 回数H, 回数L → 受信 1B: status
; タイマーは IO ボード側にあり、番号 0 / 1 の 2 本。初期化直後は停止している。
; 周期 0 で停止、回数 0 で無限。
;
; 引数は第1=R0、第2=R1、第3以降はスタック（asm-rules.mdc の呼び出し規約）。
; R2-R4 は非破壊なので先頭で PUSH し、復帰前に逆順で POP する。
; 送信フレームはスタック上に確保する（_WORK は使わない）。

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global gl_bios_timer_set
	.global gl_hshk_initiate_send
	.global gl_hshk_send_byte
	.global gl_hshk_finalize_send
	.global gl_hshk_wait_req1_1
	.global gl_hshk_accept_request
	.global gl_hshk_recv_byte
	.global gl_hshk_finalize_recv

BIOS_TIMER_FRAME_LEN	.equ	6

; -------------------------------------------------------
; タイマー設定（19h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - タイマー番号（0 または 1）
; @param R1 - 周期 ms（16bit、0 で停止）
; @param S+2 - 回数（16bit、0 で無限）-スタック
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1
; -------------------------------------------------------
gl_bios_timer_set:
	push	R2
	push	R3
	push	R4

	; 第3引数（回数）。入口では S+2、3 PUSH 後は SP+5
	mv	X0, SP
	l	R2, 5(X0)

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

	bald	gl_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	mv	X0, SP
	ai	X0, #1			; フレーム先頭
	mvwi	X1, #BIOS_TIMER_FRAME_LEN
bios_timer_send_lp:
	l	R0, 0(X0)
	bald	gl_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail
	ai	X0, #1
	si	X1, #1, Z
	b	bios_timer_send_lp

	bald	gl_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	; 応答 1 バイトは IO→CPU の転送で届く。割り込みを待たず REQ_1 をポーリングする
	bald	gl_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_recv_fail

	bald	gl_hshk_finalize_recv

	l	R0, *GL_HSHK_RECV_DATA
	andi	R0, #0x00ff
	b	bios_timer_done

bios_timer_recv_fail:
	bald	gl_hshk_finalize_recv
bios_timer_fail:
	mvwi	R0, #HSHK_NG
bios_timer_done:
	ai	SP, #BIOS_TIMER_FRAME_LEN
	pop	R4
	pop	R3
	pop	R2
	ret
