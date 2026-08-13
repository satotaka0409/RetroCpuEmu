	.cpu	mn1613

	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_breakpoint_interrupt_handler

; -------------------------------------------------------
; アドレスブレイク（INT_CAUSE=4）
; CPLD 比較器ヒット後に INT2 割り込み要因4
; 18h ブレイク通知は後続。当面は即復帰する。
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_breakpoint_interrupt_handler:

	ret

