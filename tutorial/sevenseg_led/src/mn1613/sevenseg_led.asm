; sevenseg_led.asm
; アドレス 8 桁＋データ 4 桁の外周を、時計回りに 1 セグメントずつ回す（MN1613）
; 開始ワード 1800h。BIOS はブートモニタを BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 16h・10h・11h / asm_rules.mdc
; ビット: [0..7] = [a, b, c, d, e, f, g, dp]（seven_segment_bit_map.svg）
;
; 12 桁を 1 枚の矩形と見て外周だけ点灯する（g と dp は使わない）。
; 上辺 a を左→右、右端 b→c、下辺 d を右→左、左端 e→f。28 ステップで一周。
; LED 16h はフリーモード専用。砲弾は消灯。4 周したら HALT。
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
PATH_LEN	.equ	28
REV_COUNT	.equ	4
; 20000 tick ≒ 200ms（符号付き比較に収まる）
WAIT_TICKS	.equ	20000
; 経路ワード: 上位=桁 0–11、下位=セグメントビット
SEG_A		.equ	0x01
SEG_B		.equ	0x02
SEG_C		.equ	0x04
SEG_D		.equ	0x08
SEG_E		.equ	0x10
SEG_F		.equ	0x20

	.area	_CODE		(REL,CON)
	.org	0x1800

; フリーモードにして外周を時計回りに 4 周し、HALT する
; @note 1800h から RUN。BIOS へは BALD
; 周回数は _WORK。経路カウンタは R4（入れ子の PUSH にしない）
g_user_main:
	eor	R0, R0
	mv	STR, R0			; 割り込みレベル 0。BIOS の応答待ちを INT2 と混ぜない
	mvwi	R0, #MODE_FREE
	bald	g_bios_mode_set
	mvwi	R0, #REV_COUNT
	std	R0, rev_left
l_rev:
	mvwi	X0, #path_tab
	mvwi	R4, #PATH_LEN
l_step:
	bald	l_led_buf_clear
	l	R0, 0(X0)
	bald	l_paint_seg
	mvwi	R0, #led_buf
	bald	g_bios_led_display
	bald	l_wait_ticks
	ai	X0, #1
	si	R4, #1
	cwi	R4, #0, Z
	b	l_step
	ld	R4, rev_left
	si	R4, #1
	std	R4, rev_left
	cwi	R4, #0, Z
	b	l_rev
	bald	l_led_buf_clear
	mvwi	R0, #led_buf
	bald	g_bios_led_display
	bd	g_main_loop

; 経路ワードを led_buf の 1 桁へ書く（同一桁は OR）
; @param R0 - 上位=桁 0–11、下位=セグメントビット
; @Destruction R0, R1, R2
l_paint_seg:
	mv	R1, R0
	andi	R1, #0x00ff		; セグメント
	bswp	R0, R0
	andi	R0, #0x00ff		; 桁
	mvwi	R2, #led_buf
	a	R2, R0
	lr	R0, (R2)
	or	R0, R1
	str	R0, (R2)
	ret

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

	.area	_DATA		(REL,CON)
; 12 桁外周・時計回り。0–7=ADDR、8–11=DATA
path_tab:
	.dw	0x0000+SEG_A		; 上辺 左→右
	.dw	0x0100+SEG_A
	.dw	0x0200+SEG_A
	.dw	0x0300+SEG_A
	.dw	0x0400+SEG_A
	.dw	0x0500+SEG_A
	.dw	0x0600+SEG_A
	.dw	0x0700+SEG_A
	.dw	0x0800+SEG_A
	.dw	0x0900+SEG_A
	.dw	0x0A00+SEG_A
	.dw	0x0B00+SEG_A
	.dw	0x0B00+SEG_B		; 右端 上→下
	.dw	0x0B00+SEG_C
	.dw	0x0B00+SEG_D		; 下辺 右→左
	.dw	0x0A00+SEG_D
	.dw	0x0900+SEG_D
	.dw	0x0800+SEG_D
	.dw	0x0700+SEG_D
	.dw	0x0600+SEG_D
	.dw	0x0500+SEG_D
	.dw	0x0400+SEG_D
	.dw	0x0300+SEG_D
	.dw	0x0200+SEG_D
	.dw	0x0100+SEG_D
	.dw	0x0000+SEG_D
	.dw	0x0000+SEG_E		; 左端 下→上
	.dw	0x0000+SEG_F

	.area	_WORK		(REL,NOLOAD)
; 残りの周回数（4→0）
rev_left:
	.ds	1
; g_bios_led_display 用。1 ワード 1 バイト（下位 8bit）
led_buf:
	.ds	LED_SEGS
led_bullet:
	.ds	2
