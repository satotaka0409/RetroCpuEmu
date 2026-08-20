; TMS9995 モニターのメモリ配置
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc

RESET_VECTOR_BASE	.equ	0x0000
BIOS_TABLE_BASE		.equ	0x0110

; ワークスペースはオンチップ RAM 先頭
WORKSPACE_BASE		.equ	0xFF00
; 割り込み用 WP（メインと分離）
INT_WORKSPACE		.equ	0xF000
; スタックは FE00 から下へ
STACK_INIT		.equ	0xFF00

; ブレイク履歴リング（平アドレス。SBR 無し）
BP_HIST_BASE		.equ	0xE000

; ヒープ（ユーザ領域の後ろ側）
GL_ALLOC_DEFAULT_ADR	.equ	0x2000
GL_ALLOC_DEFAULT_SIZE	.equ	0x2000

	.area	_VECTOR		(REL,CON)
	.org	RESET_VECTOR_BASE

	.area	_BIOS		(REL,CON)
	.org	BIOS_TABLE_BASE

	.area	_CODE		(REL,CON)
	.area	_DATA		(REL,CON)
	.area	_WORK		(REL,NOLOAD)
