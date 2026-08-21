; breakpoint.asm
; CPLD 比較器ヒット（INT2 / INT2_CAUSE=0）
; 根拠: HandShake.mdc 1Ah / TMS9995_CPUボードメモリ_IOマップ.mdc（CRU 0043h）
;
; ヒットスロットを STCR で読み、表を参照。Bit7 なら g_bp_hist_append。
; 回数 0 または減算後 0 なら 1Ah（ヘッダ＋履歴エントリ）を送り R2=1（HALT）。
; 無効は R2=0 で継続。handshake は R2–R3 を壊すので slot=R6・表=R7。
; 呼び出し: BL / B (R11)。停止フラグは R2。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_breakpoint_interrupt_handler
	.global GL_HSHK_ADDR_BREAK
	.global GL_BP_HIST_META
	.global g_bp_hist_append
	.global g_bp_send_hist_entries
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; @return R2 - 0=継続 / 1=モニタ HALT
; -------------------------------------------------------
g_breakpoint_interrupt_handler:
	DECT	R10
	MOV	R11, (R10)

	LI	R12, #IO_BREAK_HIT_IN
	STCR	R6, #3
	ANDI	R6, #0x0003		; スロット 0–3

	MOV	R6, R0
	SLA	R0, #1
	MOV	R0, R1
	SLA	R0, #1
	A	R1, R0
	SLA	R0, #1
	AI	R0, #GL_HSHK_ADDR_BREAK
	MOV	R0, R7

	MOV	0(R7), R0		; ena
	JNE	l_bp_ena_ok
	B	l_bp_cont
l_bp_ena_ok:

	MOV	2(R7), R0		; flags
	ANDI	R0, #HSHK_AB_F_HIST
	JEQ	l_bp_count
	MOV	R6, R2
	BL	g_bp_hist_append

l_bp_count:
	MOV	4(R7), R0		; n_stop
	JEQ	l_bp_notify
	AI	R0, #-1
	MOV	R0, 4(R7)
	JEQ	l_bp_notify
	B	l_bp_cont

l_bp_notify:
	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_cmd
	B	l_bp_halt
l_bp_nt_cmd:

	LI	R2, #HSHK_CMD_BREAK_NOTIFY
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_slot
	B	l_bp_halt
l_bp_nt_slot:

	MOV	R6, R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_hc
	B	l_bp_halt
l_bp_nt_hc:

	; histCount（Bit7 時のみメタ件数）
	CLR	R9
	MOV	2(R7), R0
	ANDI	R0, #HSHK_AB_F_HIST
	JEQ	l_bp_hc_send
	MOV	R6, R0
	SLA	R0, #1
	A	R6, R0
	SLA	R0, #1
	AI	R0, #GL_BP_HIST_META
	MOV	R0, R1
	MOV	0(R1), R9
	CI	R9, #HSHK_BH_DEPTH
	JLE	l_bp_hc_send
	LI	R9, #HSHK_BH_DEPTH
l_bp_hc_send:
	MOV	R9, R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_flags
	B	l_bp_halt
l_bp_nt_flags:

	MOV	2(R7), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_cnt
	B	l_bp_halt
l_bp_nt_cnt:

	MOV	4(R7), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_addr
	B	l_bp_halt
l_bp_nt_addr:

	MOV	6(R7), R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_addr2
	B	l_bp_halt
l_bp_nt_addr2:
	MOV	8(R7), R2
	BL	g_hshk_send_word
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_hc2
	B	l_bp_halt
l_bp_nt_hc2:

	MOV	R9, R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_pad
	B	l_bp_halt
l_bp_nt_pad:
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_ents
	B	l_bp_halt
l_bp_nt_ents:

	MOV	R6, R2			; slot
	MOV	R9, R3			; 件数
	BL	g_bp_send_hist_entries
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_fin
	B	l_bp_halt
l_bp_nt_fin:

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_wait
	B	l_bp_halt
l_bp_nt_wait:

	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_acc
	B	l_bp_halt
l_bp_nt_acc:
	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JEQ	l_bp_nt_recv
	B	l_bp_halt
l_bp_nt_recv:
	BL	g_hshk_recv_byte
	BL	g_hshk_finalize_recv

l_bp_halt:
	LI	R2, #1
	MOV	(R10)+, R11
	B	(R11)

l_bp_cont:
	CLR	R2
	MOV	(R10)+, R11
	B	(R11)
