; タイマー設定（TMS9995 内蔵デクリメンタ）
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc / TMS9995_hardware.mdc / boot_monitor.mdc
; ハンドシェイク 12h は出さない（MN1613 専用）。
; param R1 タイマー番号（0 のみ）
; param R2 周期 ms
; param R3 回数（0=無限）
; return R1 OK/NG
;
; 1ms ティック: CLKOUT=3MHz 想定で FFFA←3000。ソフトで period/count を数える。
; 満了時は g_int3_handler → GL_INT3_ADR スロット。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_timer_set_
	.global g_timer_on_tick
	.global GL_TIMER_PERIOD
	.global GL_TIMER_COUNT
	.global GL_TIMER_ACCUM
	.global GL_TIMER_REMAIN

TMS_DEC_ADDR		.equ	0xFFFA
TMS_FLAG_CRU		.equ	0x1EE0
; CLKOUT 3MHz → 1ms = 3000 ティック（デクリメント＝CLKOUT 前提）
TMS_DEC_1MS		.equ	3000

	.area	_CODE		(REL,CON)
g_bios_timer_set_:
	MOV	R11, R9
	MOV	R1, R0
	ANDI	R0, #0x00ff
	CI	R0, #0
	JNE	l_timer_ng

	MOV	R2, R4			; period
	MOV	R3, R5			; count

	; いったん停止
	LI	R12, #TMS_FLAG_CRU
	SBZ	#1			; FLAG1=0 disable
	SBZ	#0			; FLAG0=0 timer mode

	CI	R4, #0
	JEQ	l_timer_stopped

	MOV	R4, GL_TIMER_PERIOD
	MOV	R5, GL_TIMER_COUNT
	MOV	R4, GL_TIMER_ACCUM	; 次の満了まで period ms
	MOV	R5, GL_TIMER_REMAIN

	LI	R0, #TMS_DEC_1MS
	MOV	R0, TMS_DEC_ADDR
	LI	R12, #TMS_FLAG_CRU
	SBZ	#0			; timer mode
	SBO	#1			; enable
	LIMI	#3
	LI	R1, #HSHK_OK
	B	(R9)

l_timer_stopped:
	CLR	R0
	MOV	R0, GL_TIMER_PERIOD
	MOV	R0, GL_TIMER_COUNT
	MOV	R0, GL_TIMER_ACCUM
	MOV	R0, GL_TIMER_REMAIN
	LI	R1, #HSHK_OK
	B	(R9)

l_timer_ng:
	LI	R1, #HSHK_NG
	B	(R9)

; -------------------------------------------------------
; デクリメンタ 1ms ティック（g_int3_handler から BL）
; 周期到達時に R0=1、それ以外 R0=0。停止処理もここで行う。
; -------------------------------------------------------
g_timer_on_tick:
	MOV	GL_TIMER_PERIOD, R0
	JEQ	l_tick_idle
	MOV	GL_TIMER_ACCUM, R1
	DEC	R1
	MOV	R1, GL_TIMER_ACCUM
	JNE	l_tick_wait
	; 周期満了 → 再装填
	MOV	GL_TIMER_PERIOD, R1
	MOV	R1, GL_TIMER_ACCUM
	MOV	GL_TIMER_COUNT, R1
	JEQ	l_tick_fire		; 無限
	MOV	GL_TIMER_REMAIN, R1
	DEC	R1
	MOV	R1, GL_TIMER_REMAIN
	JNE	l_tick_fire
	; 回数終了 → 停止（この満了は通知する）
	LI	R12, #TMS_FLAG_CRU
	SBZ	#1
	CLR	R0
	MOV	R0, GL_TIMER_PERIOD
	MOV	R0, GL_TIMER_COUNT
	MOV	R0, GL_TIMER_ACCUM
	MOV	R0, GL_TIMER_REMAIN
l_tick_fire:
	LI	R0, #1
	B	(R11)
l_tick_wait:
l_tick_idle:
	CLR	R0
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_TIMER_PERIOD:	.blkw	1
GL_TIMER_COUNT:		.blkw	1
GL_TIMER_ACCUM:		.blkw	1
GL_TIMER_REMAIN:	.blkw	1
