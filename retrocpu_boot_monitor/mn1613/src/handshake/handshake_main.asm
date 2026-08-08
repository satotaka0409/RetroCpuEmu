; handshake_main.asm
; IO→CPU ハンドシェイク割り込み（INT_CAUSE=2）
; 根拠: HandShake.mdc「レトロCPUボード <- 制御・I/Oボード」
;
; gl_int_handler から BALR で呼ばれるので、戻りは RETL。
; 受理 → コマンド 1 バイト受信 → テーブルで分岐 → finalize。

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global gl_handshake_interrupt_handler
	.global gl_hshk_accept_request
	.global gl_hshk_recv_byte
	.global gl_hshk_finalize_recv
	.global gl_hshk_send_byte

; -------------------------------------------------------
; レベル2割り込み: ハンドシェイク要因
; @Destruction R0, R1
; -------------------------------------------------------
gl_handshake_interrupt_handler:
	bald	gl_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_irq_fail_accept

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_irq_fail_recv

	l	R0, *GL_HSHK_RECV_DATA
	andi	R0, #0x00ff
	cwi	R0, #HSHK_CMD_IO_BASE, M
	b	hshk_irq_ge_base
	b	hshk_irq_fin
hshk_irq_ge_base:
	cwi	R0, #HSHK_CMD_IO_LIMIT, PZ
	b	hshk_irq_dispatch
	b	hshk_irq_fin

hshk_irq_dispatch:
	swi	R0, #HSHK_CMD_IO_BASE
	sl	R0, RE
	mvwi	X0, #hshk_irq_cmd_tab
	a	X0, R0
	balr	(R3)

hshk_irq_fin:
	bald	gl_hshk_finalize_recv
	retl
hshk_irq_fail_accept:
	retl

hshk_irq_fail_recv:
	bald	gl_hshk_finalize_recv
	retl

; -------------------------------------------------------
; R0 バイト受信して捨てる
; @param R0 - バイト数
; @Destruction R0, R1
; -------------------------------------------------------
hshk_irq_recv_n:
	push	R2
	mv	R2, R0
hshk_irq_rn_lp:
	mv	R0, R2, Z
	b	hshk_irq_rn_go
	pop	R2
	ret
hshk_irq_rn_go:
	bald	gl_hshk_recv_byte
	si	R2, #1
	b	hshk_irq_rn_lp

; -------------------------------------------------------
; 0 を R0 バイト送る
; @param R0 - バイト数
; @Destruction R0, R1
; -------------------------------------------------------
hshk_irq_send_zeros:
	push	R2
	mv	R2, R0
hshk_irq_sz_lp:
	mv	R0, R2, Z
	b	hshk_irq_sz_go
	pop	R2
	ret
hshk_irq_sz_go:
	eor	R0, R0
	bald	gl_hshk_send_byte
	si	R2, #1
	b	hshk_irq_sz_lp

; -------------------------------------------------------
; 未実装コマンド（ペイロードは読まず NG も返さない）
; -------------------------------------------------------
hshk_irq_unknown:
	retl

; 40h メモリ/IOブレイク設定
hshk_irq_40:
	mvwi	R0, #HSHK_IRQ_PAY_40
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 41h メモリ/IOブレイク解除
hshk_irq_41:
	mvwi	R0, #HSHK_IRQ_PAY_41
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 42h 命令ブレイク設定
hshk_irq_42:
	mvwi	R0, #HSHK_IRQ_PAY_42
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 43h 命令ブレイク解除
hshk_irq_43:
	mvwi	R0, #HSHK_IRQ_PAY_43
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 48h CPU状態取得（中身は cpu_status.asm へ移す想定。今は 0 埋め）
hshk_irq_48:
	mvwi	R0, #HSHK_IRQ_STATUS_BYTES
	bald	hshk_irq_send_zeros
	bald	gl_hshk_recv_byte
	retl

; 49h 実行指示
hshk_irq_49:
	mvwi	R0, #HSHK_IRQ_PAY_49
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

	.area	_DATA		(REL,CON)
; IO→CPU コマンド 0x40–0x60（1 エントリ = CSBR + ハンドラ、BALR 用）
hshk_irq_cmd_tab:
	.dw	0
	.dw	hshk_irq_40			; 40
	.dw	0
	.dw	hshk_irq_41			; 41
	.dw	0
	.dw	hshk_irq_42			; 42
	.dw	0
	.dw	hshk_irq_43			; 43
	.dw	0
	.dw	hshk_irq_unknown		; 44
	.dw	0
	.dw	hshk_irq_unknown		; 45
	.dw	0
	.dw	hshk_irq_unknown		; 46
	.dw	0
	.dw	hshk_irq_unknown		; 47
	.dw	0
	.dw	hshk_irq_48			; 48
	.dw	0
	.dw	hshk_irq_49			; 49
	.dw	0
	.dw	hshk_irq_unknown		; 4A
	.dw	0
	.dw	hshk_irq_unknown		; 4B
	.dw	0
	.dw	hshk_irq_unknown		; 4C
	.dw	0
	.dw	hshk_irq_unknown		; 4D
	.dw	0
	.dw	hshk_irq_unknown		; 4E
	.dw	0
	.dw	hshk_irq_unknown		; 4F
	.dw	0
	.dw	hshk_irq_unknown		; 50
	.dw	0
	.dw	hshk_irq_unknown		; 51
	.dw	0
	.dw	hshk_irq_unknown		; 52
	.dw	0
	.dw	hshk_irq_unknown		; 53
	.dw	0
	.dw	hshk_irq_unknown		; 54
	.dw	0
	.dw	hshk_irq_unknown		; 55
	.dw	0
	.dw	hshk_irq_unknown		; 56
	.dw	0
	.dw	hshk_irq_unknown		; 57
	.dw	0
	.dw	hshk_irq_unknown		; 58
	.dw	0
	.dw	hshk_irq_unknown		; 59
	.dw	0
	.dw	hshk_irq_unknown		; 5A
	.dw	0
	.dw	hshk_irq_unknown		; 5B
	.dw	0
	.dw	hshk_irq_unknown		; 5C
	.dw	0
	.dw	hshk_irq_unknown		; 5D
	.dw	0
	.dw	hshk_irq_unknown		; 5E
	.dw	0
	.dw	hshk_irq_unknown		; 5F
	.dw	0
	.dw	hshk_irq_unknown		; 60
