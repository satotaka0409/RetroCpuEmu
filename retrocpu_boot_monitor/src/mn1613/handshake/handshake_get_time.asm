; handshake_get_time.asm
; 時刻取得（ハンドシェイク 11h）
; 根拠: HandShake.mdc「時刻取得」/ boot_monitor.mdc
;
; 線上 送信 1B: 11h → 受信 9B: 時刻7..時刻0 + status
; 呼び元がスタックに 4 ワード（1 ワード 2 バイト、ビッグエンディアン）を確保する。
; BALD 入口で SP+2 … SP+5 = (時刻7:6) … (時刻1:0)。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; g_* は BALD / RET。コードはセグメント 0。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_get_time_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

HSHK_TIME_WORDS		.equ	4

; -------------------------------------------------------
; 時刻取得（11h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param S+2 - 時刻バッファ先頭（4 ワード。ビッグエンディアン、時刻7:6 → 時刻1:0）-スタック（BALD）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_get_time_:
	push	R3
	push	R4

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_time_fail

	mvwi	R0, #HSHK_CMD_GET_TIME
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_time_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_time_fail

	; 応答 9 バイトは IO→CPU の転送で届く。割り込みを待たず REQ_1 をポーリングする
	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_time_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_time_fail

	; バッファ: BALD 入口 S+2 …、2 PUSH 後は SP+4 … SP+7
	; X1(=R4) は残ワード数。組立は R2。ポインタは push で退避。
	mv	X0, SP
	ai	X0, #4
	mvwi	X1, #HSHK_TIME_WORDS
l_hshk_time_recv_lp:
	push	X0
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_time_recv_fail_pop
	andi	R1, #0x00ff
	bswp	R2, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_time_recv_fail_pop
	andi	R1, #0x00ff
	or	R2, R1
	pop	X0
	st	R2, 0(X0)
	ai	X0, #1
	si	X1, #1, Z
	b	l_hshk_time_recv_lp

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_time_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_hshk_time_done

l_hshk_time_recv_fail_pop:
	pop	X0
l_hshk_time_recv_fail:
	bald	g_hshk_finalize_recv
l_hshk_time_fail:
	mvwi	R0, #HSHK_NG
l_hshk_time_done:
	pop	R4
	pop	R3
	ret