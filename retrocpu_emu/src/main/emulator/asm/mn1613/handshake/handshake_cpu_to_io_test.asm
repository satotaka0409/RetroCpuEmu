; CPU→IO ハンドシェイク結合テスト用ドライバ
; 根拠: HandShake.mdc
; 実行開始: 0x0200
; 送信: 0xAB, 0xCD の2バイト → H

.include "handshake_common.asm"

STACK_TOP	.equ	0xffff

.org	0x0200
gl_hshk_test_send:
	mvwi	SP, STACK_TOP

	bald	gl_hshk_initiate_send
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_fail

	mvi	R0, 0xab
	bald	gl_hshk_send_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_fail

	mvi	R0, 0xcd
	bald	gl_hshk_send_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_fail

	bald	gl_hshk_finalize_send
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_fail

	mvi	R0, HSHK_OK
	std	R0, gl_hshk_test_result
	h

hshk_test_fail:
	mvi	R0, HSHK_NG
	std	R0, gl_hshk_test_result
	h

gl_hshk_test_result:
	.word	0xffff
