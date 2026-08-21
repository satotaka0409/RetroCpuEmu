; handshake_main.asm
; IO→CPU ハンドシェイク割り込み（INT2 / INT2_CAUSE=ハンドシェイク）
; 根拠: HandShake.mdc「レトロCPUボード <- 制御・I/Oボード」
;
; g_int2_handler から BALD で呼ばれるので、戻りは RET。
; 受理 → コマンド 1 バイト受信 → 1 ワード表 + ゼロページ BAL で分岐 → finalize。
; IO→CPU コマンド 0x10–0x18。高位 ID（0x80–0x89）受信時は 0x70 を引いて正規化。
; g_* は BALD / RET。コードはセグメント 0。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_handshake_interrupt_handler
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global g_hshk_send_byte
	.global g_hshk_read_memory
	.global g_hshk_write_memory
	.global g_hshk_read_io
	.global g_hshk_write_io
	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr
	.global g_hshk_break_hist_get
	.global g_hshk_break_resume

; -------------------------------------------------------
; レベル2割り込み: ハンドシェイク要因
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_handshake_interrupt_handler:
	push	R3
	push	R4
	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_irq_fail_accept

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_irq_fail_recv

	mv	R0, R1
	andi	R0, #0x00ff
	mv	R2, R0
	andi	R2, #0x00f0
	cwi	R2, #HSHK_CMD_IO_HI_BASE, Z
	b	l_hshk_irq_range
	b	l_hshk_irq_hi_chk
l_hshk_irq_hi_chk:
	mv	R2, R0
	andi	R2, #0x000f
	cwi	R2, #0x000a, M
	b	l_hshk_irq_range
	b	l_hshk_irq_hi_norm
l_hshk_irq_hi_norm:
	swi	R0, #HSHK_CMD_IO_WIRE_BIAS
l_hshk_irq_range:
	cwi	R0, #HSHK_CMD_IO_BASE, M
	b	l_hshk_irq_ge_base
	b	l_hshk_irq_fin
l_hshk_irq_ge_base:
	cwi	R0, #HSHK_CMD_IO_LIMIT, PZ
	b	l_hshk_irq_dispatch
	b	l_hshk_irq_fin

l_hshk_irq_dispatch:
	swi	R0, #HSHK_CMD_IO_BASE	; 0-based index（1 word/entry）
	mvwi	X0, #l_hshk_irq_cmd_tab
	a	X0, R0
	l	R1, 0(X0)
	st	R1, *l_hshk_irq_bal_tmp
	bal	(*l_hshk_irq_bal_tmp)

l_hshk_irq_fin:
	bald	g_hshk_finalize_recv
	pop	R4
	pop	R3
	ret

l_hshk_irq_fail_accept:
	pop	R4
	pop	R3
	ret

l_hshk_irq_fail_recv:
	bald	g_hshk_finalize_recv
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; R0 バイト受信して捨てる
; @param R0 - バイト数
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_hshk_irq_recv_n:
	mv	R2, R0
l_hshk_irq_rn_lp:
	mv	R0, R2, Z
	b	l_hshk_irq_rn_go
	ret
l_hshk_irq_rn_go:
	bald	g_hshk_recv_byte
	si	R2, #1
	b	l_hshk_irq_rn_lp

; -------------------------------------------------------
; 未実装コマンド（ペイロードは読まず NG も返さない）
; -------------------------------------------------------
l_hshk_irq_unknown:
	ret

; 10h アドレスブレイク設定
l_hshk_irq_10:
	bald	g_hshk_addr_break_set
	ret

; 11h アドレスブレイク解除
l_hshk_irq_11:
	bald	g_hshk_addr_break_clr
	ret

; 12h 実行指示
l_hshk_irq_12:
	mvwi	R0, #HSHK_IRQ_PAY_EXEC
	bald	l_hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	ret

; 13h メモリ読み出し
l_hshk_irq_13:
	bald	g_hshk_read_memory
	ret

; 14h メモリ書き込み
l_hshk_irq_14:
	bald	g_hshk_write_memory
	ret

; 15h IO読み出し
l_hshk_irq_15:
	bald	g_hshk_read_io
	ret

; 16h IO書き込み
l_hshk_irq_16:
	bald	g_hshk_write_io
	ret

; 17h ブレイク履歴取得
l_hshk_irq_17:
	bald	g_hshk_break_hist_get
	ret

; 18h ブレイク復帰（0=通常 / 1=ステップ）
l_hshk_irq_18:
	bald	g_hshk_break_resume
	ret

	.area	_SYS_PAGE0		(REL,NOLOAD)
; BAL 間接ディスパッチ用（handshake IRQ）
l_hshk_irq_bal_tmp:
	.ds	1

	.area	_DATA		(REL,CON)
; IO→CPU コマンド 0x10–0x18（1 エントリ = ハンドラアドレス。ゼロページ BAL）
l_hshk_irq_cmd_tab:
	.dw	l_hshk_irq_10			; 10 比較器ブレイク設定
	.dw	l_hshk_irq_11			; 11 比較器ブレイク解除
	.dw	l_hshk_irq_12			; 12 実行指示
	.dw	l_hshk_irq_13			; 13 メモリ読み出し
	.dw	l_hshk_irq_14			; 14 メモリ書き込み
	.dw	l_hshk_irq_15			; 15 IO読み出し
	.dw	l_hshk_irq_16			; 16 IO書き込み
	.dw	l_hshk_irq_17			; 17 ブレイク履歴取得
	.dw	l_hshk_irq_18			; 18 ブレイク復帰
