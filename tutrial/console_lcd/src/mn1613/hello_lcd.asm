; hello_lcd.asm
; LCD1602 に HELLO WORLD を出すチュートリアル（MN1613）
; 開始ワード 1800h。BIOS はブートモニタ（g_bios_lcd_*）を BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 17h・18h
;
; 実行:
;   1. エミュレータを起動（F7 RST でモニタを DMA）
;   2. Intel HEX でこの IHX を読む
;   3. アドレス 1800h から RUN

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

LCD_CLEAR	.equ	0
LCD_DISPLAY	.equ	2
LCD_DISP_ON	.equ	1
HELLO_MSG1_LEN	.equ	len(hello_msg1)
HELLO_MSG2_LEN	.equ	len(hello_msg2)

	.area	_CODE		(REL,CON)
	.org	0x1800

; LCD を初期化して 1 行目に HELLO WORLD を書き、停止する
; @Destruction R0, R1, R2（R3 は BIOS が保存。引数には使わない）
g_user_main:
	eor	R0, R0
	mv	STR, R0			; BIOS ポーリング中に INT2 を上げない
	eor	R0, R0			; Clear
	eor	R1, R1
	eor	R2, R2
	bald	g_bios_lcd_control

	mvwi	R0, #LCD_DISPLAY	; Display on
	mvwi	R1, #LCD_DISP_ON
	eor	R2, R2
	bald	g_bios_lcd_control

	eor	R0, R0			; 行 0 / 列 0（Bit8-9=行, Bit0-7=列）
	mvwi	R1, #HELLO_MSG1_LEN
	mvwi	R2, #hello_msg1
	bald	g_bios_lcd_text

	mvwi	R0, #0x100		; 行 1 / 列 0
	mvwi	R1, #HELLO_MSG2_LEN
	mvwi	R2, #hello_msg2
	bald	g_bios_lcd_text

	bd	g_main_loop

	.area	_DATA		(REL,CON)
; 1 ワード 1 ASCII（下位 8bit）。BIOS g_bios_lcd_text のバッファ形式
hello_msg1:
	.dw	"HELLO WORLD"
hello_msg2:
	.dw	"HELLO MN1613"
