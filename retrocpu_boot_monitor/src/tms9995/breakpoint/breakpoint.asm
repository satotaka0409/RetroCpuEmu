; breakpoint.asm
; CPLD 比較器ヒット（INT2 / INT2_CAUSE=0）
; 根拠: HandShake.mdc 1Ah / TMS9995_CPUボードメモリ_IOマップ.mdc（CRU 0043h）
;
; ヒットスロットを STCR で読み、表を参照。Bit7 なら g_bp_hist_append。
; 簡略: 値比較・回数減算は省略し、有効スロットなら 1Ah 最小ヘッダを送って R1=1（HALT）。
; 無効は R1=0 で継続。handshake は R3–R5 を壊すので slot=R6・表=R7。
; 呼び出し: BL / B (R11)。停止フラグは R1。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_breakpoint_interrupt_handler
	.global GL_HSHK_ADDR_BREAK
	.global g_bp_hist_append
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; return R1 0=継続 / 1=モニタ HALT
; -------------------------------------------------------
g_breakpoint_interrupt_handler:
	MOV	R11, R8

	LI	R12, #IO_BREAK_HIT_IN
	STCR	R6, #3
	ANDI	R6, #0x0007

	MOV	R6, R0
	SLA	R0, #1
	MOV	R0, R1
	SLA	R0, #1
	A	R1, R0
	SLA	R0, #1
	AI	R0, #GL_HSHK_ADDR_BREAK
	MOV	R0, R7

	MOV	0(R7), R0		; ena
	JEQ	l_bp_cont

	MOV	2(R7), R0		; flags
	ANDI	R0, #HSHK_AB_F_HIST
	JEQ	l_bp_notify
	MOV	R6, R0
	BL	g_bp_hist_append

l_bp_notify:
	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	LI	R1, #HSHK_CMD_BREAK_NOTIFY
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	MOV	R6, R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	MOV	2(R7), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	MOV	4(R7), R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	MOV	6(R7), R10
	BL	l_bp_send_be16
	CI	R1, #HSHK_OK
	JNE	l_bp_halt
	MOV	8(R7), R10
	BL	l_bp_send_be16
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_bp_halt

	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_bp_halt
	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_bp_halt
	BL	g_hshk_recv_byte
	BL	g_hshk_finalize_recv

l_bp_halt:
	LI	R1, #1
	B	(R8)

l_bp_cont:
	CLR	R1
	B	(R8)

; R10 の 16bit を BE で 2 バイト送信。結果ステータスは R1
l_bp_send_be16:
	MOV	R11, R9
	MOV	R10, R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_bp_sbe_done
	MOV	R10, R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
l_bp_sbe_done:
	B	(R9)
