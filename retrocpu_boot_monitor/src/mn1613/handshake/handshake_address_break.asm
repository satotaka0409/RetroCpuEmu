; handshake_address_break.asm
; アドレスブレイク設定・解除（ハンドシェイク 10h / 11h、IO→CPU）
; 根拠: HandShake.mdc「アドレスブレイク設定」「メモリ/IOブレイク解除」
;
; コマンド 1B は IRQ ディスパッチ済み。
; 10h 残り 9B: slot, flags, count, addr32 BE, data16 BE → 送信 1B status
; 11h 残り 1B: slot → 送信 1B status
; スロット 0–3。番号不正は設定を変えず NG。
; 比較器設定は _WORK の GL_HSHK_ADDR_BREAK に保持する（CPLD IO は未マップ）。
; g_* は BALD / RET。表ポインタは R4 に保持。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr
	.global GL_HSHK_ADDR_BREAK
	.global g_hshk_recv_byte
	.global g_hshk_send_byte

; -------------------------------------------------------
; アドレスブレイク設定（10h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_addr_break_set:
	push	R3
	push	R4

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	andi	R1, #0x00ff
	mv	R2, R1
	cwi	R2, #HSHK_AB_SLOTS, M
	b	l_ab_set_bad

	; X1 = GL_HSHK_ADDR_BREAK + slot * 6（X0 作業用に潰すので X1 に保持）
	mv	R0, R2
	sl	R0, RE
	mv	R2, R0
	sl	R0, RE
	a	R2, R0
	mvwi	X1, #GL_HSHK_ADDR_BREAK
	a	X1, R2

	mvi	R0, #1
	st	R0, 0(X1)

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	andi	R1, #0x00ff
	st	R1, 1(X1)

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	andi	R1, #0x00ff
	st	R1, 2(X1)

	bald	l_ab_recv_word
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	st	R2, 3(X1)

	bald	l_ab_recv_word
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	st	R2, 4(X1)

	bald	l_ab_recv_word
	cwi	R0, #HSHK_OK, Z
	b	l_ab_set_fail
	st	R2, 5(X1)

	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_ab_set_done

l_ab_set_bad:
	mvwi	R2, #8
l_ab_set_drain:
	bald	g_hshk_recv_byte
	si	R2, #1, Z
	b	l_ab_set_drain
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_ab_set_done

l_ab_set_fail:
	mvwi	R0, #HSHK_NG
l_ab_set_done:
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; アドレスブレイク解除（11h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_addr_break_clr:
	push	R3
	push	R4

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_clr_fail
	andi	R1, #0x00ff
	mv	R2, R1
	cwi	R2, #HSHK_AB_SLOTS, M
	b	l_ab_clr_bad

	mv	R0, R2
	sl	R0, RE
	mv	R2, R0
	sl	R0, RE
	a	R2, R0
	mvwi	X1, #GL_HSHK_ADDR_BREAK
	a	X1, R2

	mvwi	R1, #HSHK_AB_SLOT_WORDS
	eor	R0, R0
l_ab_clr_z:
	st	R0, 0(X1)
	ai	X1, #1
	si	R1, #1, Z
	b	l_ab_clr_z

	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_ab_clr_done

l_ab_clr_bad:
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_ab_clr_done

l_ab_clr_fail:
	mvwi	R0, #HSHK_NG
l_ab_clr_done:
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; ビッグエンディアン 2 バイト → R2
; @return R0 - OK / NG。OK 時 R2 = ワード
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_ab_recv_word:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_rw_fail
	andi	R1, #0x00ff
	bswp	R2, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_ab_rw_fail
	andi	R1, #0x00ff
	a	R2, R1
	mvwi	R0, #HSHK_OK
	ret
l_ab_rw_fail:
	mvwi	R0, #HSHK_NG
	ret

	.area	_WORK		(REL,NOLOAD)
; スロット 0–3。各 6 ワード: ena / flags / count / addr_hi / addr_lo / data
; ena: ブレイク有効フラグ
; flags: ブレイク条件
; count: ブレイク回数
; addr_hi: ブレイクアドレス上位
; addr_lo: ブレイクアドレス下位
; data: ブレイク条件のデータ
GL_HSHK_ADDR_BREAK:	.ds	HSHK_AB_TBL_WORDS
