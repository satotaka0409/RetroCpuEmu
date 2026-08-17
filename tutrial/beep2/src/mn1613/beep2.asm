; beep2.asm
; ドレミファソラシドを 1 音 0.5 秒ずつ鳴らして HALT する（MN1613）
; 開始ワード 1800h。BIOS はブートモニタ（g_bios_beep / g_hshk_get_time）を BALD する。
; 根拠: boot_monitor.mdc / HandShake.mdc 19h・11h / asm_rules.mdc
;
; 最初のドは 261Hz。以降は平均律（2^(n/12)）を最寄り Hz。
; g_bios_beep は依頼を出した時点で戻る（鳴り終わりは待たない）。
; 次の音の前に IO の 64bit 時刻（約 10µs/tick）で 0.5 秒待つ。
;
; 実行:
;   1. エミュレータを起動（F7 RST でモニタを DMA）
;   2. Intel HEX でこの IHX を読む
;   3. アドレス 1800h から RUN

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

BEEP_MS		.equ	500
NOTE_COUNT	.equ	8
; 25000 tick ≒ 250ms。符号付き比較が使える範囲で 2 回回して 0.5 秒
WAIT_TICKS	.equ	25000

	.area	_CODE		(REL,CON)
	.org	0x1800

; ドレミファソラシドを 0.5 秒ずつ鳴らしてモニタ HALT へ戻る
; @note 1800h から RUN。BIOS へは BALD
g_user_main:
	eor	R0, R0
	mv	STR, R0			; BIOS ポーリング中に INT2 を上げない
	mvwi	X0, #note_freq		; 表ポインタ（BIOS は R3/R4 を壊さない）
	mvwi	R4, #NOTE_COUNT
l_note:
	l	R0, 0(X0)
	mvwi	R1, #BEEP_MS
	bald	g_bios_beep
	bald	l_wait_500ms
	ai	X0, #1
	si	R4, #1, Z
	b	l_note
	bd	g_main_loop

; 約 0.5 秒待つ（250ms × 2）
; @Destruction R0, R1, R2
l_wait_500ms:
	bald	l_wait_250ms
	bald	l_wait_250ms
	ret

; IO 時刻の下位 16bit が WAIT_TICKS 進むまで待つ
; @note 呼び元確保の 4 ワードへ g_hshk_get_time が書く（boot_monitor.mdc）
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

	.area	_DATA		(REL,CON)
; 平均律 Hz（C4=261）。1 ワード 1 音
note_freq:
	.dw	261			; ド
	.dw	293			; レ
	.dw	329			; ミ
	.dw	348			; ファ
	.dw	391			; ソ
	.dw	439			; ラ
	.dw	493			; シ
	.dw	522			; ド（1 オクターブ上）
