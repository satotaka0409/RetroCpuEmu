; TMS9995 割り込みハンドラ
; INT1 = ハンドシェイク、INT2 = ブレイク / ステップ、INT3 = 内蔵デクリメンタ
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc / interrupt_io.inc
; 入口は BLWP 相当（R13/R14/R15 保存済み）。復帰は RTWP。
; 引数規約: ステータス等は R1。スロット表は 2 語 × 2（0/1）× INT0–3。

	.cpu	tms9995
	.include "memmap.inc"
	.include "interrupt_io.inc"
	.include "handshake/handshake_io.inc"

	.global g_set_int_adr
	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global GL_INT0_ADR
	.global GL_INT1_ADR
	.global GL_INT2_ADR
	.global GL_INT3_ADR
	.global GL_UNDEF_INST_REG

	.global g_handshake_interrupt_handler
	.global g_breakpoint_interrupt_handler
	.global g_step_interrupt_handler
	.global g_step_arm_cpld
	.global g_bios_undef_led
	.global g_timer_on_tick
	.global g_main_loop

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; 割り込みベクタ登録（スロット 2 語 × 8）
; param R1 スロット番号 0–7（INT0-0 … INT3-1）
; param R2 ハンドラアドレス（0 でクリア）。上位語は常に 0
; -------------------------------------------------------
g_set_int_adr:
	MOV	R1, R0
	SLA	R0, #1			; ×2 語オフセット
	AI	R0, #GL_INT0_ADR
	CLR	(R0)+
	MOV	R2, (R0)
	B	(R11)

; -------------------------------------------------------
; INT0: 未定義／登録スロット
; -------------------------------------------------------
g_int0_handler:
	LI	R12, #0
	SBO	#INTERRUPT_BUSY_BIT
	LI	R1, #1
	BL	g_bios_undef_led
	LI	R0, #GL_INT0_ADR
	BL	l_run_int_slots
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	RTWP

; -------------------------------------------------------
; INT1: CAUSE 01=ハンドシェイク（タイマーは INT3）
; -------------------------------------------------------
g_int1_handler:
	LI	R12, #0
	SBO	#INTERRUPT_BUSY_BIT

	LI	R12, #INT1_CAUSE_BASE
	STCR	R0, #2
	ANDI	R0, #INT1_CAUSE_MASK
	CI	R0, #INT1_CAUSE_HSHK
	JNE	l_int1_done
	BL	g_handshake_interrupt_handler

l_int1_done:
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	BL	g_step_arm_cpld
	RTWP

; -------------------------------------------------------
; INT2: CAUSE 0=ブレイク、1=ステップ
; 停止時 R1≠0 → g_main_loop（モニタ HALT）
; -------------------------------------------------------
g_int2_handler:
	LI	R12, #0
	SBO	#INTERRUPT_BUSY_BIT

	LI	R12, #0
	TB	#INT2_CAUSE_BIT
	JEQ	l_int2_step		; EQ=1 → bit=1 → ステップ
	BL	g_breakpoint_interrupt_handler
	JMP	l_int2_after
l_int2_step:
	BL	g_step_interrupt_handler

l_int2_after:
	MOV	R1, R0
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	CI	R0, #0
	JEQ	l_int2_cont
	; モニタへ（IDLE ループ）。WP は現状維持で B
	B	g_main_loop

l_int2_cont:
	RTWP

; -------------------------------------------------------
; INT3: 内蔵デクリメンタ（1ms ティック → 周期満了で登録スロット）
; -------------------------------------------------------
g_int3_handler:
	LI	R12, #0
	SBO	#INTERRUPT_BUSY_BIT
	BL	g_timer_on_tick
	CI	R0, #0
	JEQ	l_int3_done
	LI	R0, #GL_INT3_ADR
	BL	l_run_int_slots
l_int3_done:
	LI	R12, #0
	SBZ	#INTERRUPT_BUSY_BIT
	RTWP

; R0 = スロット表先頭（2 語 × 2）。各エントリの第 2 語が PC。0 ならスキップ
l_run_int_slots:
	MOV	R11, R8
	MOV	R0, R9
	MOV	2(R9), R4
	JEQ	l_run_slot1
	BL	(R4)
l_run_slot1:
	MOV	6(R9), R4
	JEQ	l_run_slots_done
	BL	(R4)
l_run_slots_done:
	B	(R8)

	.area	_WORK		(REL,NOLOAD)
; INT0–3 × スロット2 × 2語
GL_INT0_ADR:		.blkw	4
GL_INT1_ADR:		.blkw	4
GL_INT2_ADR:		.blkw	4
GL_INT3_ADR:		.blkw	4
GL_UNDEF_INST_REG:	.blkw	16
