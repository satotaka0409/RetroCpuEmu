; mn1613_mon
; MN1613のモニタープログラム
; リセット後、このプログラムからMN1613のプログラムを起動する
;
; 配置は memmap.inc（.area _VECTOR / _CODE / _DATA / _WORK / スタック）に従う。

	.include "interrupt_io.inc"
	.include "memmap.inc"

	.global gl_int_handler
	.global gl_main
	.global gl_rnd_init

; --- _WORK: BIOS 乱数（bios_common.asm） ---
GL_RND_DEFAULT_SEED	.equ	0x1234

; 割り込みベクタ（ロード時に書き込む定数）
	.area	_VECTOR		(ABS,OVR)
	.org	INT_VECTOR_BASE
	.dw	0b11100000		; STR
	.dw	int0_handler

	.org	INT_VECTOR_BASE + 2
	.dw	0b11100000		; STR
	.dw	int1_handler

	.org	INT_VECTOR_BASE + 4
	.dw	0b11100000		; STR
	.dw	gl_int_handler		; IC

	.org	INT_VECTOR_BASE + 6
	.dw	0b11100000		; STR
	.dw	int3_handler

	.area	_CODE		(REL,CON)
gl_main:
;	スタック初期化
	mvwi	SP, #STACK_TOP
; NPP=1（リセット互換。SETS で特殊レジスタへ）
	mvi	R0, #1
	sets	R0, NPP
; 	割り込み許可
	mvi	STR, #0b11100000
;       乱数初期化
	mvwi	R0, #GL_RND_DEFAULT_SEED
	bald	gl_rnd_init
;       HALT
	h

; --- INT0 割り込みハンドラ ---
int0_handler:
	lpsw	0

; --- INT1 割り込みハンドラ ---
int1_handler:
	lpsw	1

; --- INT3 割り込みハンドラ (ソフト割り込み) ---
int3_handler:
	lpsw	3
