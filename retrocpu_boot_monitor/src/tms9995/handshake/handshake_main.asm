; IO→CPU ハンドシェイク割り込み（INT1 / INT1_CAUSE=ハンドシェイク）
; 受理 → コマンド受信 → 10h–18h ディスパッチ → finalize。
; 高位 ID（0x80–0x89）受信時は 0x70 を引いて正規化（MN1613 / HandShake.mdc と同規約）。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

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

	.area	_CODE		(REL,CON)

g_handshake_interrupt_handler:
	DECT	R10
	MOV	R11, (R10)
	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_hshk_irq_ret

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_hshk_irq_fail_recv

	MOV	R3, R0
	ANDI	R0, #0x00ff
	; 80h–89h → 10h–19h（上位ニブル 8 かつ下位 < 0xA）
	MOV	R0, R2
	ANDI	R2, #0x00f0
	CI	R2, #HSHK_CMD_IO_HI_BASE
	JNE	l_hshk_irq_range
	MOV	R0, R2
	ANDI	R2, #0x000f
	CI	R2, #0x000a
	JHE	l_hshk_irq_range
	AI	R0, #-HSHK_CMD_IO_WIRE_BIAS
l_hshk_irq_range:
	CI	R0, #HSHK_CMD_IO_BASE
	JL	l_hshk_irq_fin
	CI	R0, #HSHK_CMD_IO_LIMIT
	JHE	l_hshk_irq_fin

	AI	R0, #-HSHK_CMD_IO_BASE
	SLA	R0, #1			; 語オフセット
	AI	R0, #l_hshk_irq_cmd_tab
	MOV	(R0), R4
	BL	(R4)

l_hshk_irq_fin:
	BL	g_hshk_finalize_recv
l_hshk_irq_ret:
	MOV	(R10)+, R11
	B	(R11)

l_hshk_irq_fail_recv:
	BL	g_hshk_finalize_recv
	MOV	(R10)+, R11
	B	(R11)

; 未実装: 実行指示はペイロード破棄 + NG
l_hshk_irq_12:
	MOV	R11, R9
	LI	R5, #HSHK_IRQ_PAY_EXEC
l_hshk_irq_12_lp:
	MOV	R5, R5
	JEQ	l_hshk_irq_12_ng
	BL	g_hshk_recv_byte
	AI	R5, #-1
	JMP	l_hshk_irq_12_lp
l_hshk_irq_12_ng:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
	B	(R9)

l_hshk_irq_cmd_tab:
	.word	g_hshk_addr_break_set	; 10h
	.word	g_hshk_addr_break_clr	; 11h
	.word	l_hshk_irq_12		; 12h
	.word	g_hshk_read_memory	; 13h
	.word	g_hshk_write_memory	; 14h
	.word	g_hshk_read_io		; 15h
	.word	g_hshk_write_io		; 16h
	.word	g_hshk_break_hist_get	; 17h
	.word	g_hshk_break_resume	; 18h
