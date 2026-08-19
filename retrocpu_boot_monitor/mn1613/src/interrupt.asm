; mn1613_mon
; 割り込みハンドラー
;
; g_* / l_* は BALD / RET。コードはセグメント 0。

	.cpu	mn1613

	.include "interrupt_io.inc"
	.include "handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_set_int_adr
	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global g_handshake_interrupt_handler
	.global g_breakpoint_interrupt_handler
	.global g_step_interrupt_handler
	.global g_step_arm_cpld
	.global g_bios_undef_led
	.global g_write_cpu_registers
	; @unwarning
	.global g_main_loop
	.global GL_UNDEF_INST_REG
	.global GL_INT0_ADR
	.global GL_INT1_ADR
	.global GL_INT2_ADR
	.global GL_INT3_ADR

; -------------------------------------------------------
; 割り込みベクタ登録
; @param R0 割り込みベクタ番号
; 各割り込みは2つまで処理を登録できる。
; 割り込みは INT0-3 まである。
; INT2は、ハンドシェイク、タイマー割り込みと兼用。
; INT1は、比較器ブレイク、ステップ実行と兼用。
; INT3は、ソフトウェア割り込み用である。
;           0:INT0-0
;           1:INT0-1
;           2:INT1-0
;           3:INT1-1
;           4:INT2-0
;           5:INT2-1
;           6:INT3-0
;           7:INT3-1
; @param R1 上位アドレス 16-17
; @param R2 下位アドレス 0-15
; R1, R2 が0の場合はクリアする。
; @Destruction R0, R1
; -------------------------------------------------------
g_set_int_adr:
	push	R3
	; 1 スロット = 2 ワード → 番号を ×2
	sl	R0
	mvwi	X0, #GL_INT0_ADR
	a	X0, R0
	; 上位アドレスはセグメントなので左2ビットシフト（SBR 下位2bit=0）
	sl	R1
	sl	R1
	st	R1, 0(X0)
	st	R2, 1(X0)
	pop	R3
	ret

; -------------------------------------------------------
; INT0 割り込みハンドラー
; 未定義命令（IISR bit15）なら 13h で UNDEF LED を点灯しメインループへ。
; 通常のレベル0は LPSW 0 で復帰する。
; -------------------------------------------------------
g_int0_handler:
	pshm
	; 未定義命令が実行されたかチェック（IISR bit15 = LSB 0x0001）
	cpyh	R0, IISR
	andi	R0, #0x0001, NZ
	; @cp undefined_instruction
	b	l_int0_handler_normal_interrupt
	; @cp copy_registers
	; 割り込みマスクを再許可（main.asm の COLD と同じ M0|M1|M2）
	ori	STR, #0x0700
	; 未定義命令 INT0 用レジスタ格納領域を書き出し
	mvwi	R0, #GL_UNDEF_INST_REG
	bald	g_write_cpu_registers
	; 未定義命令実行通知（13h）を送る
	mvi	R0, #1
	bald	g_bios_undef_led
	; IISR 未定義命令フラグクリア
	eor	R0, R0
	seth	R0, IISR
	popm
	bd	g_main_loop
	; INT0 0-1 割り込みハンドラー
l_int0_handler_normal_interrupt:
	; INT0 0 割り込みハンドラー
	mvwi	X0, #GL_INT0_ADR
	l	R0, 1(X0)
	; 0の場合はスキップ（X0=R3）
	or	R0, R0, Z
	balr	(R3)
	; INT0 1 割り込みハンドラー
	; ※ label+N 即値はリンク再配置されないことがあるため ai でずらす
	mvwi	X0, #GL_INT0_ADR
	ai	X0, #2
	l	R0, 1(X0)
	or	R0, R0, Z
	balr	(R3)
	popm
	lpsw	0

; -------------------------------------------------------
; INT1 割り込みハンドラー（要因 Bit0: 0=比較器ブレイク、1=ステップ）
; -------------------------------------------------------
g_int1_handler:
	pshm
	cpyb	R0, TSR0
	cpyb	R1, TSR1
	push	R0
	push	R1
	si	SP, #1
	mv	X1, SP
	mvwi	R0, #1
	wt	R0, INTERRUPT_BUSY
	rd	R0, INT_CAUSE
	andi	R0, #INT1_CAUSE_MASK
	st	R0, 1(X1)
	push	X1
	; 互換のため INT1 退避を共有退避へミラーする
	l	R0, *INT1_STR_SAVE
	st	R0, *HSHK_L2_STR_SAVE
	l	R0, *INT1_IC_SAVE
	st	R0, *HSHK_L2_IC_SAVE
	; 要因分岐（Bit0: 0=比較器ブレイク / 1=ステップ）
	l	R0, 1(X1)
	cbi	R0, #INT1_CAUSE_BREAK, NZ
	b	l_int1_do_break
	cbi	R0, #INT1_CAUSE_STEP, NZ
	b	l_int1_do_step
	b	l_int1_epilogue
l_int1_do_break:
	bald	g_breakpoint_interrupt_handler
	or	R0, R0, Z
	b	l_int1_halt
	b	l_int1_epilogue
l_int1_do_step:
	bald	g_step_interrupt_handler
	or	R0, R0, Z
	b	l_int1_halt
l_int1_epilogue:
	pop	X1
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	ai	SP, #1
	pop	R1
	pop	R0
	setb	R1, TSR1
	setb	R0, TSR0
	; 18h ステップなら LPSW 1 の直前に CPLD を武装する
	bald	g_step_arm_cpld
	popm
	lpsw	1
l_int1_halt:
	pop	X1
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	ai	SP, #1
	pop	R1
	pop	R0
	setb	R1, TSR1
	setb	R0, TSR0
	popm
	bd	g_main_loop

; -------------------------------------------------------
; INT2 割り込みハンドラー（要因 Bit1-2: 00=タイマー、01=ハンドシェイク）
; -------------------------------------------------------
g_int2_handler:
	pshm
	cpyb	R0, TSR0
	cpyb	R1, TSR1
	push	R0
	push	R1
	; スタックを下げて領域を確保
	si	SP, #1
	mv	X1, SP
	; 割り込み処理実行中フラグをセット
	mvwi	R0, #1
	wt	R0, INTERRUPT_BUSY
	; 割り込み要因を読み込み
	rd	R0, INT_CAUSE
	andi	R0, #INT2_CAUSE_MASK
	; 割り込み要因を格納
	st	R0, 1(X1)
	push	X1
	; タイマー（Bit1-2=00）: INT2 0 割り込みハンドラー
	l	R0, 1(X1)
	or	R0, R0, Z
	b	l_next_handshake
	mvwi	X0, #GL_INT2_ADR
	l	R0, 1(X0)
	or	R0, R0, Z
	balr	(R3)
l_next_handshake:
	pop	X1
	push	X1
	; ハンドシェイク割り込み（Bit1-2=01）
	l	R0, 1(X1)
	cbi	R0, #INT2_CAUSE_HSHK, NZ
	bald	g_handshake_interrupt_handler
	pop	X1
	; 割り込み処理実行中フラグをクリア
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	; 確保した 1 ワードを捨てる
	ai	SP, #1
	pop	R1
	pop	R0
	setb	R1, TSR1
	setb	R0, TSR0
	popm
	lpsw	2

; -------------------------------------------------------
; INT3 割り込みハンドラー
; -------------------------------------------------------
g_int3_handler:
	pshm
	; INT3 0 割り込みハンドラー
	mvwi	X0, #GL_INT3_ADR
	l	R0, 1(X0)
	or	R0, R0, Z
	balr	(R3)
	; INT3 1 割り込みハンドラー
	mvwi	X0, #GL_INT3_ADR
	ai	X0, #2
	l	R0, 1(X0)
	or	R0, R0, Z
	balr	(R3)
	popm
	lpsw	3

	.area	_WORK		(REL,NOLOAD)
GL_INT0_ADR:	.ds	4
GL_INT1_ADR:	.ds	4
GL_INT2_ADR:	.ds	4
GL_INT3_ADR:	.ds	4

	.area	_WORK		(REL,NOLOAD)
; 未定義命令 INT0 用レジスタ格納領域
GL_UNDEF_INST_REG:	.ds	HSHK_REG_WORDS
