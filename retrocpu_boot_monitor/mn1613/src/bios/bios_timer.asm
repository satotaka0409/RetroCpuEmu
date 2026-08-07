; bios_timer.asm
; タイマー設定 BIOS（ハンドシェイク 19h）
; 根拠: HandShake.mdc「タイマー設定」/ boot_monitor.mdc「タイマー割り込み」
;
; 線上 送信 6B: 19h, タイマー番号, 周期H, 周期L, 回数H, 回数L → 受信 1B: status
; タイマーは IO ボード側にあり、番号 0 / 1 の 2 本。初期化直後は停止している。
; 周期 0 で停止、回数 0 で無限。

.include "../handshake/handshake_common.asm"

.global gl_bios_timer_set

BIOS_TIMER_FRAME_LEN	.equ	6

; -------------------------------------------------------
; タイマー設定（19h）
; @param R1 - タイマー番号（0 または 1）
; @param R2 - 周期 ms（16bit、0 で停止）
; @param R3 - 回数（16bit、0 で無限）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @note 番号が 0/1 以外のときは IO ボードが HSHK_NG を返す
; @Destruction R0, R1, R2, R3, R4
; -------------------------------------------------------
gl_bios_timer_set:
	; X0 は R3 と同じレジスタなので、回数を先に退避する
	std	R3, bios_timer_count

	mvwi	X0, bios_timer_frame
	mvi	R0, HSHK_CMD_TIMER_SET
	st	R0, 0(X0)
	mv	R0, R1
	andi	R0, 0x00ff
	st	R0, 1(X0)
	bswp	R0, R2
	andi	R0, 0x00ff
	st	R0, 2(X0)
	mv	R0, R2
	andi	R0, 0x00ff
	st	R0, 3(X0)
	ld	R1, bios_timer_count
	bswp	R0, R1
	andi	R0, 0x00ff
	st	R0, 4(X0)
	mv	R0, R1
	andi	R0, 0x00ff
	st	R0, 5(X0)

	bald	gl_hshk_initiate_send
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	mvwi	X0, bios_timer_frame
	mvi	X1, BIOS_TIMER_FRAME_LEN
bios_timer_send_lp:
	l	R0, 0(X0)
	bald	gl_hshk_send_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail
	ai	X0, 1
	si	X1, 1, Z
	b	bios_timer_send_lp

	bald	gl_hshk_finalize_send
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	; 応答 1 バイトは IO→CPU の転送で届く。割り込みを待たず REQ_1 をポーリングする
	bald	gl_hshk_wait_req1_1
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_accept_request
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	bios_timer_recv_fail

	bald	gl_hshk_finalize_recv

	ld	R0, gl_hshk_recv_data
	andi	R0, 0x00ff
	ret

bios_timer_recv_fail:
	bald	gl_hshk_finalize_recv
bios_timer_fail:
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; 作業変数（1 ワード 1 バイト、上位バイト先の送信順）
; -------------------------------------------------------
bios_timer_frame:
	.word	0		; 19h
	.word	0		; タイマー番号
	.word	0		; 周期H
	.word	0		; 周期L
	.word	0		; 回数H
	.word	0		; 回数L

bios_timer_count:
	.word	0
