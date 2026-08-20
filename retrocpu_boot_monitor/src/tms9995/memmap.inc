; TMS9995 モニターのメモリ配置（最小実装）
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc

RESET_VECTOR_BASE	.equ	0x0000
BIOS_TABLE_BASE		.equ	0x0110

; TMS9995 は 0xFF00-0xFFFF をオンチップ RAM として使える。
; R0-R15 のワークスペースは先頭 32byte（0xFF00-0xFF1F）。
WORKSPACE_BASE		.equ	0xFF00
STACK_INIT		.equ	0xFE00

	.area	_VECTOR		(REL,CON)
	.org	RESET_VECTOR_BASE

	.area	_BIOS		(REL,CON)
	.org	BIOS_TABLE_BASE

	.area	_CODE		(REL,CON)
	.area	_DATA		(REL,CON)
	.area	_WORK		(REL,NOLOAD)
