; handshake_led.asm
; LED表示依頼（ハンドシェイク 16h）
; 根拠: HandShake.mdc「LED表示依頼」/ boot_monitor.mdc
;
; 線上 送信 16B: 16h, pad(00) + 7seg×12 + bullet0_7 + bullet8_F → 受信 1B: status
; フリーモード専用。モニターモードは IO が 01h（モードエラー）を返す。
; 7セグと砲弾は同一トランザクションのため、片方だけ更新する API は
; システムゼロページ（_SYS_PAGE0 の GL_HSHK_LED_LATCH、14 ワード。
; bios 7 ワード + handshake_main の BAL 作業 1 ワードの次 = 0010h）。
;
; ユーザバッファはワードアドレス、1 ワード 1 バイト（下位 8bit）。
; 引数は第1=R0、第2=R1（asm-rules.mdc の呼び出し規約）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。
; g_* は BALD / RET。送信ループのポインタは R2 に退避する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bios_led_display_
	; @unwarning
	.global g_bios_led_seven_seg
	; @unwarning
	.global g_bios_led_bullet
	.global GL_HSHK_LED_LATCH
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; 7セグ＋砲弾を一括更新（16h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - バッファ先頭（ワードアドレス。14 ワード、各下位 8bit）
; @return R0 - OK / 01h モードエラー / 02h その他
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_led_display_:
	push	R3
	push	R4
	mvwi	R1, #HSHK_LED_DATA_LEN
	bald	l_hshk_led_copy
	bald	l_hshk_led_xfer
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; 7セグ 12 桁を更新し、砲弾はラッチまたは 0（16h）
; @param R0 - パターンバッファ先頭（12 ワード、各下位 8bit）
; @param R1 - 砲弾維持（0=両バイト 0 / 1=内部ラッチ）
; @return R0 - OK / 01h モードエラー / 02h その他
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_led_seven_seg:
	push	R3
	push	R4
	mv	R2, R1
	mvwi	R1, #HSHK_LED_SEG_LEN
	bald	l_hshk_led_copy
	cwi	R2, #0, Z
	b	l_led_ss_keep_bullet
	eor	R0, R0
	st	R0, 0(X1)
	st	R0, 1(X1)
l_led_ss_keep_bullet:
	bald	l_hshk_led_xfer
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; 砲弾 16 本を更新し、7セグは内部ラッチ（16h）
; @param R0 - 砲弾 0–7（下位 8bit）
; @param R1 - 砲弾 8–F（下位 8bit）
; @return R0 - OK / 01h モードエラー / 02h その他
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_led_bullet:
	push	R3
	push	R4
	andi	R0, #0x00ff
	andi	R1, #0x00ff
	mvwi	X1, #GL_HSHK_LED_LATCH
	ai	X1, #HSHK_LED_SEG_LEN
	st	R0, 0(X1)
	st	R1, 1(X1)
	bald	l_hshk_led_xfer
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; ユーザバッファから内部ラッチへコピーする
; @param R0 - 転送元先頭（ワードアドレス）
; @param R1 - ワード数
; @note 戻り時 X1 はラッチ上の次ワード（seven_seg の砲弾位置）
; @Destruction R0, R1, X0, X1
; -------------------------------------------------------
l_hshk_led_copy:
	mv	X0, R0
	mvwi	X1, #GL_HSHK_LED_LATCH
l_hshk_led_copy_lp:
	l	R0, 0(X0)
	andi	R0, #0x00ff
	st	R0, 0(X1)
	ai	X0, #1
	ai	X1, #1
	si	R1, #1, Z
	b	l_hshk_led_copy_lp
	ret

; -------------------------------------------------------
; 内部ラッチ 14 バイトを 16h で送り、status 1B を受け取る
; @return R0 - IO の status。線エラー時は HSHK_NG_OTHER
; @Destruction R0, R1, R2, X0, X1
; -------------------------------------------------------
l_hshk_led_xfer:
	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail

	mvwi	R0, #HSHK_CMD_LED_DISPLAY
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail

	eor	R0, R0
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail

	mvwi	X0, #GL_HSHK_LED_LATCH
	mvwi	X1, #HSHK_LED_DATA_LEN
l_led_xfer_send_lp:
	mv	R2, X0
	l	R0, 0(X0)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail
	mv	X0, R2
	ai	X0, #1
	si	X1, #1, Z
	b	l_led_xfer_send_lp

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_led_xfer_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_led_xfer_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	ret

l_led_xfer_recv_fail:
	bald	g_hshk_finalize_recv
l_led_xfer_fail:
	mvwi	R0, #HSHK_NG_OTHER
	ret

	.area	_SYS_PAGE0		(REL,NOLOAD)
GL_HSHK_LED_LATCH:	.ds	14
