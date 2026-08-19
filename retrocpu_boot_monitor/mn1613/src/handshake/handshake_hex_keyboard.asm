; handshake_hex_keyboard.asm
; 16進キー入力取得（ハンドシェイク 14h）
; 根拠: HandShake.mdc「16進キー入力取得」/ boot_monitor.mdc
;
; 線上 送信 1B: 14h → 受信 9B: col0..col7 + status
; 列ビットは HandShake.mdc キー配置（列0 Bit3–0 = C 8 4 0、列4 = F0 F2 F4 F6）。
; フリーモード専用。モニターモードは IO が 01h（モードエラー）を返す。
;
; 結果バッファはワードアドレス、1 ワード 1 バイト（下位 8bit、列 0–7）。
; 引数は第1=R0（asm-rules.mdc の呼び出し規約）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; g_* は BALD / RET。バッファ進行は R2。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_hex_key_get_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; 16進キー入力取得（14h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - 結果バッファ先頭（ワードアドレス。8 ワード、各下位 8bit）
; @return R0 - OK / 01h モードエラー / 02h その他
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_hex_key_get_:
	push	R3
	push	R4
	mv	R2, R0

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hex_key_fail

	mvwi	R0, #HSHK_CMD_HEX_KEY
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hex_key_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hex_key_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hex_key_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hex_key_fail

	mvwi	X1, #HSHK_HEX_KEY_COLS
l_hex_key_recv_lp:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hex_key_recv_fail
	andi	R1, #0x00ff
	mv	X0, R2
	st	R1, 0(X0)
	ai	R2, #1
	si	X1, #1, Z
	b	l_hex_key_recv_lp

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hex_key_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_hex_key_done

l_hex_key_recv_fail:
	bald	g_hshk_finalize_recv
l_hex_key_fail:
	mvwi	R0, #HSHK_NG_OTHER
l_hex_key_done:
	pop	R4
	pop	R3
	ret