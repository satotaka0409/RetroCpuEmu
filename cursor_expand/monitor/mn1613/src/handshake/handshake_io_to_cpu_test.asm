; IO→CPU ハンドシェイク結合テスト用ドライバ
; 根拠: HandShake.mdc
; 実行開始: 0x0200
; 受信: 2バイト（gl_hshk_test_buf0/1）→ H
;
; 割り込みなしでポーリング受理（テスト簡略）:
;   REQ_1=1 待ち → accept → recv×2 → finalize

.include "handshake_common.asm"

STACK_TOP	.equ	0xffff

.org	0x0200
gl_hshk_test_recv:
	mvwi	SP, STACK_TOP

; REQ_1 立ち上がり待ち（bit=0 なら再ループ、bit=1 なら先へ）
hshk_test_wait_req1:
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_REQ1_BIT, Z
	b	hshk_test_got_req1
	b	hshk_test_wait_req1
hshk_test_got_req1:

	bald	gl_hshk_accept_request
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_recv_fail

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_recv_fail
	ld	R0, gl_hshk_recv_data
	std	R0, gl_hshk_test_buf0

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_recv_fail
	ld	R0, gl_hshk_recv_data
	std	R0, gl_hshk_test_buf1

	bald	gl_hshk_finalize_recv
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_test_recv_fail

	mvi	R0, HSHK_OK
	std	R0, gl_hshk_test_result
	h

hshk_test_recv_fail:
	mvi	R0, HSHK_NG
	std	R0, gl_hshk_test_result
	h

gl_hshk_test_result:
	.word	0xffff
gl_hshk_test_buf0:
	.word	0
gl_hshk_test_buf1:
	.word	0
