; breakpoint_steprun.asm
; 1 命令ステップ（CRU ワンショット。比較器は使わない）
; 根拠: breakpoint.mdc / HandShake.mdc 18h・1Bh /
;   TMS9995_CPUボードメモリ_IOマップ.mdc（0068=ENA / 0078=DELAY）
;
; 18h: 0=通常再開（ARM クリア）/ 1=ステップ（GL_BP_STEP_ARM=1）。ENA はここでは上げない。
; INT1 エピローグの g_step_arm_cpld が DELAY/ENA を武装する。
; INT2 要因=ステップ: 1Bh 通知 → R1=1 でモニタ HALT。
; 呼び出し: BL / B (R11)。ステータス・停止フラグは R1。

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

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; ブレイク復帰（コマンド 18h）
; note 残り 1B: 実行方式。0=run / 1=step / それ以外=NG
; return R1 HSHK_OK / HSHK_NG
; -------------------------------------------------------
g_hshk_break_resume:
	MOV	R11, R8
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_sr_61_ng
	ANDI	R1, #0x00ff
	CI	R1, #HSHK_RESUME_LIMIT
	JHE	l_sr_61_ng

	MOV	R1, GL_BP_STEP_ARM
	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	B	(R8)

l_sr_61_ng:
	LI	R1, #HSHK_NG
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
	LI	R12, #IO_STEP_BRK_DELAY
	LDCR	R0, #8			; 8bit
	LI	R12, #0
	SBO	#IO_STEP_BRK_ENA
l_sr_arm_done:
	B	(R11)

; -------------------------------------------------------
; ステップヒット（INT2 / INT2_CAUSE=1）
; return R1=1（モニタ HALT）
; -------------------------------------------------------
g_step_interrupt_handler:
	MOV	R11, R8

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail

	LI	R1, #HSHK_CMD_STEP_NOTIFY
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail

	; 1Bh 線上はコマンド後に 69B（pad + addr32 + regs + pad + stack16語）。
	; TMS9995 CPU 実行コンテキスト未実装のため、現状はゼロ埋めで長さのみ仕様準拠。
	LI	R7, #69
l_sr_nt_zlp:
	MOV	R7, R7
	JEQ	l_sr_nt_fin
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail
	AI	R7, #-1
	JMP	l_sr_nt_zlp

l_sr_nt_fin:
	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail

	; 応答待ちの前に BUSY を下ろす（IO が配送できる）
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail
	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_sr_nt_fail
	BL	g_hshk_recv_byte
	BL	g_hshk_finalize_recv

l_sr_nt_fail:
	LI	R1, #1
	B	(R8)

	.area	_WORK		(REL,NOLOAD)
GL_BP_STEP_ARM:	.blkw	1
