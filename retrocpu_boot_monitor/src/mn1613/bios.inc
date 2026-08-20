; BIOS 公開エントリ（_BIOS ジャンプ表）
; 根拠: main.asm / memmap.inc（.area _BIOS .org 0x0110）
; アドレスはワード。各エントリは bd 2 語。実装本体の移動では変わらない。
; ユーザプログラムはこれを .include して BALD する。main.asm 自身には取り込まない。

g_main			.equ	0x0110
g_main_loop		.equ	0x0112
g_get_rnd		.equ	0x0114
g_mem_cpy		.equ	0x0116
g_malloc		.equ	0x0118
g_free			.equ	0x011A
g_bios_mode_set		.equ	0x011C
g_hshk_get_time		.equ	0x011E
g_bios_timer_set	.equ	0x0120
g_bios_hex_key_get	.equ	0x0122
g_bios_pc_key_get	.equ	0x0124
g_bios_led_display	.equ	0x0126
g_bios_lcd_control	.equ	0x0128
g_bios_lcd_text		.equ	0x012A
g_bios_beep		.equ	0x012C
g_bios_rtc_get_raw	.equ	0x012E
g_bios_temp_get_raw	.equ	0x0130
g_bios_light_get_raw	.equ	0x0132
g_bios_distance_get_raw	.equ	0x0134
