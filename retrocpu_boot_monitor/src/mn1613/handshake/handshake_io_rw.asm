; handshake_io_rw.asm
; IO 読み出し／書き込み（ハンドシェイク 15h / 16h、IO→CPU）
; 根拠: HandShake.mdc「IO読み出し」「IO書き込み」
;
; コマンド 1B は IRQ ディスパッチ済み。残りヘッダ 5B:
;   パッド 0 + addr16 BE + バイト数（最大 254）+ パッド 0。
; 15h: ポートを 16bit 語としてビッグエンディアンで送り、続けて status。
; 16h: 同じ並びにデータを受け、status を返す。
; g_* は BALD / RET。R3-R4 は非破壊。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_read_io
	.global g_hshk_write_io
	.global g_hshk_recv_byte
	.global g_hshk_send_byte

; -------------------------------------------------------
; IO読み出し（15h）。線上はデータ＋status（いずれも CPU→IO）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_read_io:
	push	R3
	push	R4
	bald	l_hshk_io_recv_hdr
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ior_fail
	mv	R3, R1			; port
	mv	R4, R2			; count
	cwi	R4, #HSHK_IO_LIMIT, M
	b	l_hshk_ior_ngc
l_hshk_ior_lp:
	mv	R0, R4, Z
	b	l_hshk_ior_go
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_hshk_ior_done
l_hshk_ior_go:
	rdr	R0, (R3)
	mv	R1, R0
	bswp	R0, R1
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ior_fail
	si	R4, #1, Z
	b	l_hshk_ior_hi_more
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_hshk_ior_done
l_hshk_ior_hi_more:
	andi	R1, #0x00ff
	mv	R0, R1
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ior_fail
	si	R4, #1
	awi	R3, #1
	b	l_hshk_ior_lp
l_hshk_ior_ngc:
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_hshk_ior_fail
l_hshk_ior_fail:
	mvwi	R0, #HSHK_NG
	pop	R4
	pop	R3
	ret
l_hshk_ior_done:
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ior_fail
	mvwi	R0, #HSHK_OK
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; IO書き込み（16h）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_write_io:
	push	R3
	push	R4
	bald	l_hshk_io_recv_hdr
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_iow_fail
	mv	R3, R1
	mv	R4, R2
	cwi	R4, #HSHK_IO_LIMIT, M
	b	l_hshk_iow_ngc
l_hshk_iow_lp:
	mv	R0, R4, Z
	b	l_hshk_iow_go
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_hshk_iow_done
l_hshk_iow_go:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_iow_fail
	andi	R1, #0x00ff
	bswp	R2, R1
	si	R4, #1, Z
	b	l_hshk_iow_one
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_iow_fail
	andi	R1, #0x00ff
	or	R2, R1
	wtr	R2, (R3)
	si	R4, #1
	awi	R3, #1
	b	l_hshk_iow_lp
l_hshk_iow_one:
	rdr	R0, (R3)
	andi	R0, #0x00ff
	or	R2, R0
	wtr	R2, (R3)
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	b	l_hshk_iow_done
l_hshk_iow_ngc:
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_hshk_iow_fail
l_hshk_iow_fail:
	mvwi	R0, #HSHK_NG
	pop	R4
	pop	R3
	ret
l_hshk_iow_done:
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_iow_fail
	mvwi	R0, #HSHK_OK
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; ヘッダ 5B: pad, addr16 BE, count, pad。戻り R1=port、R2=count
; @return R0 - HSHK_OK / HSHK_NG
; -------------------------------------------------------
l_hshk_io_recv_hdr:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ioh_fail
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ioh_fail
	andi	R1, #0x00ff
	bswp	R2, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ioh_fail
	andi	R1, #0x00ff
	or	R2, R1
	push	R2
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ioh_fail2
	andi	R1, #0x00ff
	pop	R0
	mv	R2, R1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	ret
	mv	R2, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_ioh_fail2
l_hshk_ioh_fail2:
l_hshk_ioh_fail:
	mvwi	R0, #HSHK_NG
	ret
