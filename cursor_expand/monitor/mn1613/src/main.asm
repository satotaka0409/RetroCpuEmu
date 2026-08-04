; mn1613_mon
; MN1613のモニタープログラム
; リセット後、このプログラムからMN1613のプログラムを起動する

.include "interrupt_io.inc"

STACK_TOP	.equ	0xffff
; 外部参照可能にする
.global gl_int_handler

; 外部参照可能にする
.global gl_main

.org	0x0100
	.dw	0b11100000		; STR
	lpsw    0

.org	0x0102
	.dw	0b11100000		; STR
	lpsw    1

.org	0x0104
	.dw	0b11100000		; STR
	b	gl_int_handler

.org	0x0106
	.dw	0b11100000		; STR
	lpsw    3

gl_main:
;	スタック初期化
	mvwi	SP, STACK_TOP
; 	割り込み許可
	mvi	SR, 0b11100000


