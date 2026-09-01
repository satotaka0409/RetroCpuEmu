; TMS9995 モニターのメモリ配置
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc

RESET_VECTOR_BASE	.equ	0x0000
BIOS_TABLE_BASE		.equ	0x0014

; ワークスペースはオンチップ RAM 先頭
WORKSPACE_BASE		.equ	0xFF00
; スタックは FE80 から下へ（メイン WP の R10）
STACK_INIT		.equ	0xFE80

; ヒープ（ユーザ領域の後ろ側）
GL_ALLOC_DEFAULT_ADR	.equ	0xE000
GL_ALLOC_DEFAULT_SIZE	.equ	0x1800

	.area	_VECTOR		(REL,CON)
	.org	RESET_VECTOR_BASE

	.area	_BIOS		(REL,CON)
	.org	BIOS_TABLE_BASE

	.area	_CODE		(REL,CON)
	.area	_DATA		(REL,CON)
	.area	_WORK		(REL,NOLOAD)
