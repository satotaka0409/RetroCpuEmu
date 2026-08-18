; piano.asm
; 16進キーボード 0をド（261Hz）
; 1:レ 2:ミ 3:ファ 4:ソ 5:ラ 6:シ 7:ド
; 押している間鳴って、離すと止まる
;
; 開始ワード 1800h。BIOS はブートモニタを BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 14h・19h / asm_rules.mdc
;
; キー配置（14h 列ビット、4×4）:
;   列 = キー番号 下位 2bit、ビット番号 = キー番号 >> 2
;   0–3 は列 0–3 の bit0、4–7 は列 0–3 の bit1（画面下 2 段）
; 複数押しは番号の小さい音を優先。g_bios_beep は duration=0 で鳴り続け、freq=0 で停止。
;
; 実行:
;   1. エミュレータを起動（F7 RST でモニタを DMA）
;   2. Intel HEX でこの IHX を読む
;   3. アドレス 1800h から RUN
;   4. 16進キー 0–7 を押し続ける（H/ST で停止）

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

MODE_FREE	.equ	1
NOTE_NONE	.equ	0xffff
NOTE_COUNT	.equ	8

	.area	_CODE		(REL,CON)
	.org	0x1800

; 16進キー 0–7 をピアノにする。離すまで鳴らし、H/ST までループする
g_user_main:
	eor	R0, R0
	mv	STR, R0			; BIOS ポーリング中に INT2 を上げない
	mvi	R0, #MODE_FREE
	bald	g_bios_mode_set
	mvwi	R0, #NOTE_NONE
	std	R0, last_note

l_loop:
	bald	l_scan_note
	ld	R1, last_note
	c	R0, R1, Z
	b	l_changed
	b	l_loop

l_changed:
	std	R0, last_note
	mvwi	R1, #NOTE_NONE
	c	R0, R1, Z
	b	l_start
	eor	R0, R0
	eor	R1, R1
	bald	g_bios_beep
	b	l_loop

l_start:
	mvwi	X0, #note_freq
	ld	R1, last_note
	a	X0, R1
	l	R0, 0(X0)
	eor	R1, R1			; 長さ 0 = 離すまで
	bald	g_bios_beep
	b	l_loop

; 押下中の 0–7 を返す。無し／取得失敗は NOTE_NONE
; @return R0 - キー番号 0–7、または 0xFFFF
; @Destruction R0, R1, R2
l_scan_note:
	push	R3
	push	R4
	mvwi	R0, #key_cols
	bald	g_bios_hex_key_get
	cwi	R0, #0, Z
	b	l_scan_none
	eor	R2, R2
l_scan_lp:
	mv	R0, R2
	cwi	R2, #4, M
	b	l_scan_hi
	mvi	R4, #1
	b	l_scan_col
l_scan_hi:
	si	R0, #4
	mvi	R4, #2
l_scan_col:
	andi	R0, #0x0003
	mvwi	X0, #key_cols
	a	X0, R0
	l	R1, 0(X0)
	and	R1, R4, Z
	b	l_scan_hit
	ai	R2, #1
	cwi	R2, #NOTE_COUNT, Z
	b	l_scan_lp
l_scan_none:
	mvwi	R0, #NOTE_NONE
	b	l_scan_done
l_scan_hit:
	mv	R0, R2
l_scan_done:
	pop	R4
	pop	R3
	ret

	.area	_DATA		(REL,CON)
; 平均律 Hz（C4=261）。beep2 と同じ表
note_freq:
	.dw	261			; 0 ド
	.dw	293			; 1 レ
	.dw	329			; 2 ミ
	.dw	348			; 3 ファ
	.dw	391			; 4 ソ
	.dw	439			; 5 ラ
	.dw	493			; 6 シ
	.dw	522			; 7 ド（1 オクターブ上）

	.area	_WORK		(REL,NOLOAD)
last_note:
	.ds	1
key_cols:
	.ds	8
