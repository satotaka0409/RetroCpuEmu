; led1.asm
; 砲弾 LED 0→F を左から右へ 1 本ずつ点灯する（MN1613）
; 開始ワード 1800h。BIOS はブートモニタを BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 16h・10h・11h / asm_rules.mdc
;
; LED 16h はフリーモード専用。7セグは消灯、砲弾だけ動かす。
; 点灯間隔は IO の 64bit 時刻（約 10µs/tick）。WAIT_TICKS=30000 で約 300ms。
; 16 本終わると先頭に戻る。止めるときは F7 RST。
;
; 実行:
;   1. エミュレータを起動（F7 RST でモニタを DMA）
;   2. Intel HEX でこの IHX を読む
;   3. アドレス 1800h から RUN

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

MODE_FREE	.equ	1
LED_SEGS	.equ	12
LED_WORDS	.equ	14
WAIT_TICKS	.equ	30000

	.area	_CODE		(REL,CON)
	.org	0x1800

; フリーモードにして砲弾 0–F を順に点灯し、繰り返す
; @note 1800h から RUN。BIOS へは BALD。モニタへは戻らない
g_user_main:
	eor	R0, R0
	mv	STR, R0			; 割り込みレベル 0。BIOS の応答待ちを INT2 と混ぜない
	mvwi	R0, #MODE_FREE
	bald	g_bios_mode_set
	bald	l_led_buf_clear

l_sweep:
	mvwi	R3, #1			; Bit0=砲弾の左端（BIOS は R3/R4 を壊さない）
	eor	R4, R4			; 0=砲弾 0–7 / 1=砲弾 8–F
l_byte:
	mv	R0, R3
	eor	R1, R1
	cwi	R4, #0, Z
	b	l_hi
	std	R0, led_lo
	std	R1, led_hi
	b	l_show
l_hi:
	std	R1, led_lo
	std	R0, led_hi
l_show:
	mvwi	R0, #led_buf
	bald	g_bios_led_display
	bald	l_wait_ticks
	sl	R3, RE
	cwi	R3, #0x0100, Z		; 8 本目の次でバイト終了（TBIT は MSB=0 なので使わない）
	b	l_byte
	cwi	R4, #0, Z
	b	l_sweep
	mvwi	R4, #1
	mvwi	R3, #1
	b	l_byte

; 7セグ 12 + 砲弾 2 を 0 にする
; @Destruction R0, R1, R2
l_led_buf_clear:
	mvwi	R1, #led_buf
	mvwi	R2, #LED_WORDS
	eor	R0, R0
l_led_buf_clr_lp:
	str	R0, (R1)+
	si	R2, #1, Z
	b	l_led_buf_clr_lp
	ret

; IO 時刻の下位 16bit が WAIT_TICKS 進むまで待つ
; @note 呼び元確保の 4 ワードへ g_hshk_get_time が書く（boot_monitor.mdc）
; @Destruction R0, R1, R2
l_wait_ticks:
	push	R3
	push	R4
	si	SP, #4
	bald	g_hshk_get_time
	mv	X1, SP
	l	R3, 4(X1)
l_wait_ticks_poll:
	bald	g_hshk_get_time
	mv	X1, SP
	l	R0, 4(X1)
	s	R0, R3
	cwi	R0, #WAIT_TICKS, LPZ
	b	l_wait_ticks_poll
	ai	SP, #4
	pop	R4
	pop	R3
	ret

	.area	_WORK		(REL,NOLOAD)
; g_bios_led_display 用。1 ワード 1 バイト（下位 8bit）
led_buf:
	.ds	LED_SEGS
led_lo:
	.ds	1
led_hi:
	.ds	1
