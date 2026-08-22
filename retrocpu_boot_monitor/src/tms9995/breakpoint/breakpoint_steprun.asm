; 1 命令ステップ（メモリマップド ワンショット。比較器は使わない）
; 根拠: breakpoint.mdc / HandShake.mdc 18h・1Bh /
;   TMS9995_CPUボードメモリ_IOマップ.mdc（FE86=ENA / FE87=DELAY）
;
; 18h: 0=通常再開（ARM クリア）/ 1=ステップ（GL_BP_STEP_ARM=1）。ENA はここでは上げない。
; INT1 エピローグの g_step_arm_cpld が DELAY/ENA を武装する。
; INT2 要因=ステップ: 1Bh 通知 → R2=1 でモニタ HALT。
; 呼び出し: BL / B (R11)。ステータス・停止フラグは R2。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_hshk_break_resume
	.global g_step_arm_cpld
	.global g_step_interrupt_handler
	.global GL_BP_STEP_ARM
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_initiate_send
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_finalize_recv
	.global g_bp_send_user_state_body

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; ブレイク復帰（コマンド 18h）
; note 残り 1B: 実行方式。0=run / 1=step / それ以外=NG
; @return R2 - HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_break_resume:
	MOV	R11, R8
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_sr_61_ng
	ANDI	R3, #0x00ff
	CI	R3, #HSHK_RESUME_LIMIT
	JHE	l_sr_61_ng

	MOV	R3, GL_BP_STEP_ARM
	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	B	(R8)

l_sr_61_ng:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
	B	(R8)

; -------------------------------------------------------
; INT1 エピローグから呼ぶ。ARM≠0 なら DELAY=STEP_BRK_DELAY_1STEP・ENA=1
; -------------------------------------------------------
g_step_arm_cpld:
	MOV	GL_BP_STEP_ARM, R0
	JEQ	l_sr_arm_done
	CLR	R0
	MOV	R0, GL_BP_STEP_ARM
	LI	R0, #STEP_BRK_DELAY_1STEP
	SWPB	R0
	LI	R1, #IO_STEP_BRK_DELAY
	MOVB	R0, (R1)
	LI	R0, #1
	SWPB	R0
	LI	R1, #IO_STEP_BRK_ENA
	MOVB	R0, (R1)
l_sr_arm_done:
	B	(R11)

; -------------------------------------------------------
; ステップヒット（INT2 / INT2_CAUSE=1）
; 1Bh: cmd + pad + addr32 + R0–R15 + stack16 = 70B
; @return R2 - 1（モニタ HALT）
; -------------------------------------------------------
g_step_interrupt_handler:
	MOV	R11, R8

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail

	LI	R2, #HSHK_CMD_STEP_NOTIFY
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail

	BL	g_bp_send_user_state_body
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail

	; 応答待ちの前に BUSY を下ろす（IO が配送できる）
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail
	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_sr_nt_fail
	BL	g_hshk_recv_byte
	BL	g_hshk_finalize_recv

l_sr_nt_fail:
	LI	R2, #1
	B	(R8)

	.area	_WORK		(REL,NOLOAD)
GL_BP_STEP_ARM:	.blkw	1
