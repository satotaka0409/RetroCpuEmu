; handshake_get_register.asm
; CPU状態取得（ハンドシェイク 48h、IO→CPU）
; 根拠: HandShake.mdc「CPU状態取得」/ boot_monitor.mdc
;
; R0 = 構造体先頭（ワードアドレス、HSHK_REG_WORDS ワード）。
; 線上は 0x16 バイト（ビッグエンディアン、11 ワード）＋ OK/NG 1B。
; g_* は BALD / RET。R0 が構造体先頭。構造体ポインタは R2/X1 に保持。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_get_register
	.global g_hshk_send_word
	.global g_hshk_recv_byte

; -------------------------------------------------------
; CPU状態構造体を送信（48h ペイロード）
; @param R0 - 構造体先頭（ワードアドレス）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_get_register:
	push	R3
	push	R4
	; 構造体ポインタは X1（send_word が R2 を壊す）
	mv	X1, R0

	l	R0, HSHK_REG_W_R0(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_R1(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_R2(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_R3(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_R4(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_SP(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_STR(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_IC(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_CSBR_SSBR(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_TSR0_1(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_REG_W_NPP_IISR(X1)
	bald	g_hshk_send_word

	bald	g_hshk_recv_byte
	pop	R4
	pop	R3
	ret