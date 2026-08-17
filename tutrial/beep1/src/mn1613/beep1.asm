; beep.asm
; 440Hz 1秒と 880Hz 1秒を交互に 4 回鳴らす（MN1613）
; 開始ワード 1800h。BIOS はブートモニタ（g_bios_beep / g_hshk_get_time）を BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 19h・11h
;
; g_bios_beep は依頼を出した時点で戻る（鳴り終わりは待たない）。
; 次の音の前に IO の 64bit 時刻（約 10µs/tick）で 1 秒待つ。
;
; 実行:
;   1. エミュレータを起動（F7 RST でモニタを DMA）
;   2. Intel HEX でこの IHX を読む
;   3. アドレス 1800h から RUN

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

BEEP_MS		.equ	1000
REPEAT		.equ	4
FREQ_A		.equ	440
FREQ_B		.equ	880
; 25000 tick ≒ 250ms。符号付き比較が使える範囲で 4 回回して 1 秒
WAIT_TICKS	.equ	25000

	.area	_CODE		(REL,CON)
	.org	0x1800

; 440Hz / 880Hz を 1 秒ずつ、交互に REPEAT 回鳴らしてモニタへ戻る
; @Destruction R0, R1, R2
g_user_main:
	eor	R0, R0
	mv	STR, R0			; BIOS ポーリング中に INT2 を上げない
	mvwi	R2, #REPEAT
l_beep_rep:
	push	R2
	mvwi	R0, #FREQ_A
	mvwi	R1, #BEEP_MS
	bald	g_bios_beep
	bald	l_wait_1s
	mvwi	R0, #FREQ_B
	mvwi	R1, #BEEP_MS
	bald	g_bios_beep
	bald	l_wait_1s
	pop	R2
	si	R2, #1, Z
	b	l_beep_rep

	bd	g_main_loop

; 約 1 秒待つ（250ms × 4）
; @Destruction R0, R1, R2
l_wait_1s:
	mvi	R2, #4
l_wait_1s_lp:
	push	R2
	bald	l_wait_250ms
	pop	R2
	si	R2, #1, Z
	b	l_wait_1s_lp
	ret

; IO 時刻の下位 16bit が WAIT_TICKS 進むまで待つ
; @Destruction R0, R1, R2
l_wait_250ms:
	push	R3
	push	R4
	si	SP, #4
	bald	g_hshk_get_time
	mv	X1, SP
	l	R3, 4(X1)
l_wait_250ms_poll:
	bald	g_hshk_get_time
	mv	X1, SP
	l	R0, 4(X1)
	s	R0, R3
	cwi	R0, #WAIT_TICKS, LPZ
	b	l_wait_250ms_poll
	ai	SP, #4
	pop	R4
	pop	R3
	ret
