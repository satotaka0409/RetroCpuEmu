; mn1613_mon
; MN1613のモニタープログラム
; リセット後、このプログラムからMN1613のプログラムを起動する
;
; 配置は memmap.inc（.area _VECTOR / _CODE / _DATA / _WORK / スタック）に従う。

	.cpu	mn1613

	.include "interrupt_io.inc"
	.include "memmap.inc"

	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global g_main
	.global g_rnd_init
	.global g_malloc_init
	.global g_malloc2_init
	.global g_main_loop
	.global s__WORK
	.global l__WORK

; --- _WORK: BIOS 乱数（bios_common.asm） ---
GL_RND_DEFAULT_SEED	.equ	0x1234

; 割り込みベクタ（ロード時に書き込む定数）
	.area	_VECTOR		(REL,CON)
; INT0
	.dw	0b0000001100000000	; STR
	.dw	g_int0_handler		; INT0 割り込みハンドラ
; INT1
	.dw	0b0000010100000000	; STR
	.dw	g_int1_handler		; INT1 割り込みハンドラ
; INT2
	.dw	0b0000011000000000	; STR
	.dw	g_int2_handler		; IC（タイマー0/1・ハンドシェイク）
; INT3
	.dw	0x0000011100000000	; STR
	.dw	g_int3_handler

	.area	_CODE		(REL,CON)
g_main:
; COLD START
	b	l_reset
g_main_loop:
; HOT START
	b	l_main_loop
l_reset:
;	スタック初期化
	mvwi	SP, #STACK_TOP
; ゼロページ領域を0クリアする（ゼロ初期化）
	mvwi	X0, #0x0000
	mvwi    R1, #0x0100
	eor	R0, R0
l_zero_loop:
	st	R0, 0(X0)
	ai	X0, #1
	si	R1, #1, Z
	b	l_zero_loop
; _WORK領域を0クリアする（ゼロ初期化）。s__WORK / l__WORK は sdld が出す。
; 命令即値はワード開始／ワード数（CDB 上のバイト値を ÷2 した値）。
	mvwi	X0, #s__WORK
	mvwi	R1, #l__WORK
l_work_loop:
	st	R0, 0(X0)
	ai	X0, #1
	si	R1, #1, Z
	b	l_work_loop
;       乱数初期化
	mvwi	R0, #GL_RND_DEFAULT_SEED
	bald	g_rnd_init
;       ヒープ初期化
	mvwi	R0, #GL_ALLOC_DEFAULT_ADR
	mvwi	R1, #GL_ALLOC_DEFAULT_SIZE
	bald	g_malloc_init
	mvwi	R0, #GL_ALLOC2_DEFAULT_ADR
	mvwi	R1, #GL_ALLOC2_DEFAULT_SBR
	mvwi	R2, #GL_ALLOC2_DEFAULT_SIZE
	bald	g_malloc2_init
; 	割り込み許可（M0|M1|M2 = STR bit10/9/8 = 0x0700）
	mvwi	R0, #0b0000011100000000
	mv	STR, R0
;       HALT
l_main_loop:
	h
	b	l_main_loop

