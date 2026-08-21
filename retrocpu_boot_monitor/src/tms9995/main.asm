; tms9995 monitor main

	.cpu	tms9995

	.include "memmap.inc"

	.global g_main
	.global g_main_loop
	.global g_get_rnd
	.global g_mem_cpy
	.global g_malloc
	.global g_free
	.global g_bios_mode_set
	.global g_hshk_get_time
	.global g_bios_timer_set
	.global g_bios_hex_key_get
	.global g_bios_pc_key_get
	.global g_bios_led_display
	.global g_bios_lcd_control
	.global g_bios_lcd_text
	.global g_bios_beep
	.global g_bios_rtc_get_raw
	.global g_bios_temp_get_raw
	.global g_bios_light_get_raw
	.global g_bios_distance_get_raw

	.global g_get_rnd_
	.global g_mem_cpy_
	.global g_malloc_
	.global g_free_
	.global g_bios_mode_set_
	.global g_hshk_get_time_
	.global g_bios_timer_set_
	.global g_bios_hex_key_get_
	.global g_bios_pc_key_get_
	.global g_bios_led_display_
	.global g_bios_lcd_control_
	.global g_bios_lcd_text_
	.global g_bios_beep_
	.global g_bios_rtc_get_raw_
	.global g_bios_temp_get_raw_
	.global g_bios_light_get_raw_
	.global g_bios_distance_get_raw_

	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global g_rnd_init
	.global g_malloc_init

GL_RND_DEFAULT_SEED  .equ 0x1234

	.area	_VECTOR		(REL,CON)
	; level0 reset
	.word	WORKSPACE_BASE
	.word	l_reset
	; level1 handshake
	.word	WORKSPACE_BASE + 0x80
	.word	g_int1_handler
	; level2 break/step
	.word	WORKSPACE_BASE + 0xA0
	.word	g_int2_handler
	; level3 on-chip timer
	.word	WORKSPACE_BASE + 0xC0
	.word	g_int3_handler

	.area	_BIOS		(REL,CON)
g_main:				B	l_main
g_main_loop:			B	l_main_loop
g_get_rnd:			B	g_get_rnd_
g_mem_cpy:			B	g_mem_cpy_
g_malloc:			B	g_malloc_
g_free:				B	g_free_
g_bios_mode_set:		B	g_bios_mode_set_
g_hshk_get_time:		B	g_hshk_get_time_
g_bios_timer_set:		B	g_bios_timer_set_
g_bios_hex_key_get:		B	g_bios_hex_key_get_
g_bios_pc_key_get:		B	g_bios_pc_key_get_
g_bios_led_display:		B	g_bios_led_display_
g_bios_lcd_control:		B	g_bios_lcd_control_
g_bios_lcd_text:		B	g_bios_lcd_text_
g_bios_beep:			B	g_bios_beep_
g_bios_rtc_get_raw:		B	g_bios_rtc_get_raw_
g_bios_temp_get_raw:		B	g_bios_temp_get_raw_
g_bios_light_get_raw:		B	g_bios_light_get_raw_
g_bios_distance_get_raw:	B	g_bios_distance_get_raw_

	.area	_CODE		(REL,CON)
l_reset:
	LWPI	#WORKSPACE_BASE
	LIMI	#0
	LI	R10, #STACK_INIT
	LI	R2, #GL_RND_DEFAULT_SEED
	BL	g_rnd_init
	LI	R2, #GL_ALLOC_DEFAULT_ADR
	LI	R3, #GL_ALLOC_DEFAULT_SIZE
	BL	g_malloc_init
	LIMI	#3
	JMP	l_main

l_main:
l_main_loop:
	IDLE
	JMP	l_main_loop
