; mn1613_mon
; MN1613のモニタープログラム
; リセット後、このプログラムからMN1613のプログラムを起動する
;
; 配置は memmap.inc（.area _VECTOR / _BIOS / _CODE / _DATA / _WORK / スタック）に従う。

	.cpu	mn1613

	.include "interrupt_io.inc"
	.include "memmap.inc"

	.global g_main
	.global g_main_loop
	.global	g_get_rnd_
	.global	g_mem_cpy_
	.global g_malloc_
	.global g_free_
	.global g_malloc2_
	.global g_free2_
	.global g_bios_mode_set_
	.global	g_hshk_get_time_
	.global	g_bios_timer_set_
	.global	g_bios_hex_key_get_
	.global	g_bios_pc_key_get_
	.global	g_bios_led_display_
	.global	g_bios_lcd_control_
	.global	g_bios_lcd_text_
	.global	g_bios_beep_

	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global g_rnd_init
	.global g_malloc_init
	.global g_malloc2_init
	.global s__WORK
	.global l__WORK

; --- _WORK: BIOS 乱数（bios_common.asm） ---
GL_RND_DEFAULT_SEED	.equ	0x1234

	.area	_VECTOR		(REL,CON)
; 割り込みベクタ
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
	.dw	0b0000011100000000	; STR
	.dw	g_int3_handler
; リセットベクタ
; MN1613 はIO RD 0番地から読み込んだアドレス +2->STR +3->IC に設定してスタートする
g_reset_vector:
	.dw	0
	.dw	0
	.dw	0b0000000000000000	; STR 割り込み禁止
	.dw	l_main

	.area	_BIOS		(REL,CON)
g_main:			bd	l_main				; 0x110
g_main_loop:		bd	l_main_loop			; 0x112
g_get_rnd:		bd	g_get_rnd_			; 0x114
g_mem_cpy:		bd	g_mem_cpy_			; 0x116
g_malloc:       	bd      g_malloc_			; 0x118
g_free:			bd 	g_free_				; 0x11a
g_malloc2:      	bd      g_malloc2_			; 0x11c
g_free2:		bd 	g_free2_			; 0x11e
g_bios_mode_set:	bd	g_bios_mode_set_		; 0x120
g_hshk_get_time:	bd	g_hshk_get_time_		; 0x122
g_bios_timer_set:	bd	g_bios_timer_set_		; 0x124
g_bios_hex_key_get:	bd	g_bios_hex_key_get_		; 0x126
g_bios_pc_key_get:	bd	g_bios_pc_key_get_		; 0x128
g_bios_led_display:	bd	g_bios_led_display_		; 0x12a
g_bios_lcd_control:	bd	g_bios_lcd_control_		; 0x12c
g_bios_lcd_text:	bd	g_bios_lcd_text_		; 0x12e
g_bios_beep:		bd	g_bios_beep_			; 0x130

	.area	_CODE		(REL,CON)
l_main:
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

