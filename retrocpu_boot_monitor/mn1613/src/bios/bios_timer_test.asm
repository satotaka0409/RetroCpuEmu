; bios_timer_test.asm
; gl_bios_timer_set の結合テスト用ドライバ
; 根拠: HandShake.mdc「タイマー設定」
;
; エミュレータから 0x0200 で実行する。引数は下の 3 ワードを書き換えて渡し、
; IO ボードのステータスを GL_BIOS_TIMER_TEST_RESULT に残して停止する。

.org	0x0200
	mvwi	SP, 0xffff
	ld	R1, GL_BIOS_TIMER_TEST_NO
	ld	R2, GL_BIOS_TIMER_TEST_PERIOD
	ld	R3, GL_BIOS_TIMER_TEST_COUNT
	bald	gl_bios_timer_set
	std	R0, GL_BIOS_TIMER_TEST_RESULT
	h

GL_BIOS_TIMER_TEST_NO:
	.word	1			; タイマー番号
GL_BIOS_TIMER_TEST_PERIOD:
	.word	0x0064			; 周期 100ms
GL_BIOS_TIMER_TEST_COUNT:
	.word	0x0003			; 回数 3
GL_BIOS_TIMER_TEST_RESULT:
	.word	0x00ff			; 未実行を表す番兵

.include "bios_timer.asm"
