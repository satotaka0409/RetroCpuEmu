; handshake_main.asm
; IO→CPU ハンドシェイク割り込み（INT_CAUSE=2）
; 根拠: HandShake.mdc「レトロCPUボード <- 制御・I/Oボード」
;
; g_int2_handler から BALD で呼ばれるので、戻りは RET。
; 受理 → コマンド 1 バイト受信 → 1 ワード表 + ゼロページ BAL で分岐 → finalize。
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
	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr

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
; 0 を R0 バイト送る
; @param R0 - バイト数
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_hshk_irq_send_zeros:
	mv	R2, R0
l_hshk_irq_sz_lp:
	mv	R0, R2, Z
	b	l_hshk_irq_sz_go
	ret
l_hshk_irq_sz_go:
	eor	R0, R0
	bald	g_hshk_send_byte
	si	R2, #1
	b	l_hshk_irq_sz_lp

; -------------------------------------------------------
; 未実装コマンド（ペイロードは読まず NG も返さない）
; -------------------------------------------------------
l_hshk_irq_unknown:
	ret

; 40h アドレスブレイク設定
l_hshk_irq_40:
	bald	g_hshk_addr_break_set
	ret

; 41h アドレスブレイク解除
l_hshk_irq_41:
	bald	g_hshk_addr_break_clr
	ret

; 42h 命令ブレイク設定
l_hshk_irq_42:
	mvwi	R0, #HSHK_IRQ_PAY_42
	bald	l_hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	ret

; 43h 命令ブレイク解除
l_hshk_irq_43:
	mvwi	R0, #HSHK_IRQ_PAY_43
	bald	l_hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	ret

; 48h CPU状態取得（構造体は R0。割り込みではバッファを持たない。0x15 ゼロ）
l_hshk_irq_48:
	mvwi	R0, #HSHK_IRQ_STATUS_BYTES
	bald	l_hshk_irq_send_zeros
	bald	g_hshk_recv_byte
	ret

; 49h 実行指示
l_hshk_irq_49:
	mvwi	R0, #HSHK_IRQ_PAY_49
	bald	l_hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	ret

; 50h メモリ読み出し
l_hshk_irq_50:
	bald	g_hshk_read_memory
	ret

; 51h メモリ書き込み
l_hshk_irq_51:
	bald	g_hshk_write_memory
	ret

	.area	_SYS_PAGE0		(REL,NOLOAD)
; BAL 間接ディスパッチ用（handshake IRQ）
l_hshk_irq_bal_tmp:
	.ds	1

	.area	_DATA		(REL,CON)
; IO→CPU コマンド 0x40–0x60（1 エントリ = ハンドラアドレス。ゼロページ BAL）
l_hshk_irq_cmd_tab:
	.dw	l_hshk_irq_40			; 40
	.dw	l_hshk_irq_41			; 41
	.dw	l_hshk_irq_42			; 42
	.dw	l_hshk_irq_43			; 43
	.dw	l_hshk_irq_unknown		; 44
	.dw	l_hshk_irq_unknown		; 45
	.dw	l_hshk_irq_unknown		; 46
	.dw	l_hshk_irq_unknown		; 47
	.dw	l_hshk_irq_48			; 48
	.dw	l_hshk_irq_49			; 49
	.dw	l_hshk_irq_unknown		; 4A
	.dw	l_hshk_irq_unknown		; 4B
	.dw	l_hshk_irq_unknown		; 4C
	.dw	l_hshk_irq_unknown		; 4D
	.dw	l_hshk_irq_unknown		; 4E
	.dw	l_hshk_irq_unknown		; 4F
	.dw	l_hshk_irq_50			; 50
	.dw	l_hshk_irq_51			; 51
	.dw	l_hshk_irq_unknown		; 52
	.dw	l_hshk_irq_unknown		; 53
	.dw	l_hshk_irq_unknown		; 54
	.dw	l_hshk_irq_unknown		; 55
	.dw	l_hshk_irq_unknown		; 56
	.dw	l_hshk_irq_unknown		; 57
	.dw	l_hshk_irq_unknown		; 58
	.dw	l_hshk_irq_unknown		; 59
	.dw	l_hshk_irq_unknown		; 5A
	.dw	l_hshk_irq_unknown		; 5B
	.dw	l_hshk_irq_unknown		; 5C
	.dw	l_hshk_irq_unknown		; 5D
	.dw	l_hshk_irq_unknown		; 5E
	.dw	l_hshk_irq_unknown		; 5F
	.dw	l_hshk_irq_unknown		; 60
