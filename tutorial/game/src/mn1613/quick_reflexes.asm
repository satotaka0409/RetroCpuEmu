; quick_reflexes.asm
; 反射神経ゲーム（MN1613）
; 開始ワード 1800h。BIOS はブートモニタを BALD する。
;
; 仕様:
;  1) LCD 1行目: "ARE YOU READY?"
;  2) 1秒後に LCD 2行目: "GO"
;  3) 20ターン実施
;     - アドレス部 8桁のランダム位置に 0-F を 0.5秒表示
;     - 表示中に同じ 16進キーを押せば成功、未入力/別キーは失敗
;     - データ部 4桁に score 表示（左2桁=失敗、右2桁=成功）
;     - ターン間は 0.5〜1.0秒（10000tick 単位のランダム待機）
;  4) 終了時に LCD をクリアし、スコアを 5 秒表示して HALT

	.cpu	mn1613

	.include "../../../bios.inc"

	.global	g_user_main

MODE_FREE	.equ	1

LCD_CLEAR	.equ	0
LCD_DISPLAY	.equ	2
LCD_DISP_ON	.equ	1

LED_SEGS	.equ	12
LED_WORDS	.equ	14

GAME_TURNS	.equ	20
WAIT_100MS_TICKS	.equ	10000
; 0.5秒（10µs/tick）。LPZ は符号なし比較なので 32767 超でも可
POLL_WINDOW_TICKS	.equ	50000

	.area	_CODE		(REL,CON)
	.org	0x1800

; -------------------------------------------------------
; メイン
; -------------------------------------------------------
g_user_main:
	eor	R0, R0
	mv	STR, R0			; BIOS ポーリング中に INT2 を混ぜない

	; キー取得はフリーモード専用
	mvi	R0, #MODE_FREE
	bald	g_bios_mode_set

	; スコアはデータ部 左2桁=失敗、右2桁=成功。最初から 00 00
	eor	R0, R0
	std	R0, score_ok
	std	R0, score_ng
	mvi	R0, #GAME_TURNS
	std	R0, turns_left
	bald	l_led_buf_clear
	bald	l_update_score_digits
	mvwi	R0, #led_buf
	bald	g_bios_led_display

	; LCD 初期表示
	bald	l_lcd_init
	bald	l_lcd_ready

	; 1秒待機（100ms x 10）
	mvi	R0, #10
	bald	l_wait_100ms_chunks

	; 2行目に GO
	bald	l_lcd_go

l_game_loop:
	; 数字を出す前に離鍵。表示中の正解押しを捨てない
	bald	l_wait_keys_up
	bald	l_led_buf_clear
	bald	l_update_score_digits
	bald	l_pick_target
	bald	l_draw_target
	mvwi	R0, #led_buf
	bald	g_bios_led_display

	; 表示中判定: R0=1 success, 0 fail
	bald	l_poll_target_window
	or	R0, R0, Z
	b	l_mark_success
	b	l_mark_fail

l_mark_success:
	ld	R1, score_ok
	ai	R1, #1
	std	R1, score_ok
	b	l_turn_tail

l_mark_fail:
	ld	R1, score_ng
	ai	R1, #1
	std	R1, score_ng

l_turn_tail:
	; ターゲット消灯して score 更新
	bald	l_led_buf_clear
	bald	l_update_score_digits
	mvwi	R0, #led_buf
	bald	g_bios_led_display

	; 残りターン（0 になったら終了。Z のとき次命令をスキップ）
	ld	R0, turns_left
	si	R0, #1
	std	R0, turns_left
	cwi	R0, #0, NZ
	b	l_game_end

	; 0.5〜1.0秒待ち（100ms x (5 + extra[0..5])）
	bald	l_wait_turn_gap
	b	l_game_loop

l_game_end:
	; LCD / デバッガコンソールをクリア（17h Clear）
	eor	R0, R0
	eor	R1, R1
	eor	R2, R2
	bald	g_bios_lcd_control
	; スコアを 5 秒出したまま HALT
	mvi	R0, #50
	bald	l_wait_100ms_chunks
	h

; -------------------------------------------------------
; LCD 初期化（Clear + Display On）
; -------------------------------------------------------
l_lcd_init:
	eor	R0, R0
	eor	R1, R1
	eor	R2, R2
	bald	g_bios_lcd_control
	mvi	R0, #LCD_DISPLAY
	mvi	R1, #LCD_DISP_ON
	eor	R2, R2
	bald	g_bios_lcd_control
	ret

l_lcd_ready:
	eor	R0, R0			; row0 col0
	mvi	R1, #len(msg_ready)
	mvwi	R2, #msg_ready
	bald	g_bios_lcd_text
	ret

l_lcd_go:
	mvwi	R0, #0x0100		; row1 col0
	mvi	R1, #len(msg_go)
	mvwi	R2, #msg_go
	bald	g_bios_lcd_text
	ret

; -------------------------------------------------------
; score を data 4桁へ反映
; 左2桁: NG、右2桁: OK
; -------------------------------------------------------
l_update_score_digits:
	push	R3
	push	R4

	; fail → データ桁 0,1（l_to_decimal が X0 を壊すので毎回付け直す）
	ld	R0, score_ng
	bald	l_to_decimal_2digits	; R1=tens, R2=ones
	mvwi	X0, #led_buf
	ai	X0, #8
	st	R1, 0(X0)
	st	R2, 1(X0)

	; success → データ桁 2,3
	ld	R0, score_ok
	bald	l_to_decimal_2digits
	mvwi	X0, #led_buf
	ai	X0, #8
	st	R1, 2(X0)
	st	R2, 3(X0)

	pop	R4
	pop	R3
	ret

; R0(0..99) -> R1(十の位 seg), R2(一の位 seg)
l_to_decimal_2digits:
	eor	R1, R1			; tens
	mv	R2, R0			; ones(work)
l_dec10_lp:
	cwi	R2, #10, M
	b	l_dec10_do
	b	l_dec10_done
l_dec10_do:
	si	R2, #10
	ai	R1, #1
	b	l_dec10_lp
l_dec10_done:
	mvwi	X0, #hex_seg_tab
	a	X0, R1
	l	R1, 0(X0)
	mvwi	X0, #hex_seg_tab
	a	X0, R2
	l	R2, 0(X0)
	ret

; -------------------------------------------------------
; ターゲット値(0..F) と表示位置(0..7)を決める
; -------------------------------------------------------
l_pick_target:
	bald	g_get_rnd
	andi	R0, #0x000f
	std	R0, target_val
	bald	g_get_rnd
	andi	R0, #0x0007
	std	R0, target_pos
	ret

; -------------------------------------------------------
; アドレス部 8桁の target_pos に target_val を描画
; -------------------------------------------------------
l_draw_target:
	ld	R0, target_pos
	mvwi	X0, #led_buf
	a	X0, R0
	ld	R0, target_val
	mvwi	X1, #hex_seg_tab
	a	X1, R0
	l	R1, 0(X1)
	st	R1, 0(X0)
	ret

; -------------------------------------------------------
; 0.5秒間の入力判定（開始時刻からの経過で打ち切る）
; @return R0 - 1:成功 / 0:失敗
; -------------------------------------------------------
l_poll_target_window:
	push	R3
	push	R4
	si	SP, #4
	bald	g_hshk_get_time
	mv	X1, SP
	l	R0, 4(X1)
	std	R0, poll_t0
l_poll_step:
	bald	l_read_hex_key
	or	R0, R0, NZ
	b	l_poll_check_time	; キーなしは経過を見る

	; 入力あり: R1=key
	ld	R0, target_val
	c	R1, R0, Z
	b	l_poll_miss
	mvi	R0, #1
	b	l_poll_done

l_poll_miss:
	eor	R0, R0
	b	l_poll_done

l_poll_check_time:
	bald	g_hshk_get_time
	mv	X1, SP
	l	R0, 4(X1)
	ld	R1, poll_t0
	s	R0, R1
	cwi	R0, #POLL_WINDOW_TICKS, LPZ
	b	l_poll_step
	eor	R0, R0
l_poll_done:
	ai	SP, #4
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 全 16進キーが離されるまで待つ（表示前。押しっぱなしを次ターンに持ち越さない）
; -------------------------------------------------------
l_wait_keys_up:
	bald	l_read_hex_key
	or	R0, R0, Z
	b	l_wait_keys_up
	ret

; -------------------------------------------------------
; 16進キーを1回読む（piano.asm と同じ 14h 走査）
; @return R0 - 1:キーあり / 0:なし
; @return R1 - key(0..15)。なし時は不定
; 根拠: HandShake.mdc 14h。key = 列 + bit*4（列0 Bit0=0, Bit1=4, Bit2=8, Bit3=C）
; -------------------------------------------------------
l_read_hex_key:
	push	R3
	push	R4
	mvwi	R0, #key_cols
	bald	g_bios_hex_key_get
	cwi	R0, #0, Z
	b	l_rhk_none
	eor	R2, R2			; key 0..15
l_rhk_lp:
	mv	R0, R2
	andi	R0, #0x0003		; col
	mvwi	X0, #key_cols
	a	X0, R0
	l	R1, 0(X0)
	mv	R0, R2
	mvi	R4, #1			; mask = 1 << (key/4)
l_rhk_mask:
	cwi	R0, #4, M
	b	l_rhk_mask_sh
	b	l_rhk_mask_ok
l_rhk_mask_sh:
	si	R0, #4
	sl	R4
	b	l_rhk_mask
l_rhk_mask_ok:
	and	R1, R4, Z
	b	l_rhk_hit
	ai	R2, #1
	cwi	R2, #16, Z
	b	l_rhk_lp
l_rhk_none:
	eor	R0, R0
	pop	R4
	pop	R3
	ret
l_rhk_hit:
	mv	R1, R2
	mvi	R0, #1
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; ターン間待ち（0.5〜1.0秒）
; -------------------------------------------------------
l_wait_turn_gap:
	bald	g_get_rnd
	andi	R0, #0x0007		; 0..7
	cwi	R0, #6, M
	b	l_wtg_adj
	b	l_wtg_ok
l_wtg_adj:
	si	R0, #2			; 6->4, 7->5
l_wtg_ok:
	ai	R0, #5			; 5..10 (100ms 単位)
	bald	l_wait_100ms_chunks
	ret

; -------------------------------------------------------
; R0 回ぶん 100ms 待つ
; -------------------------------------------------------
l_wait_100ms_chunks:
	push	R4
	mv	R4, R0
l_wait_chunks_lp:
	cwi	R4, #0, Z
	b	l_wait_chunks_do
	b	l_wait_chunks_done
l_wait_chunks_do:
	bald	l_wait_100ms
	si	R4, #1
	b	l_wait_chunks_lp
l_wait_chunks_done:
	pop	R4
	ret

; -------------------------------------------------------
; 100ms 待ち（WAIT_100MS_TICKS）
; -------------------------------------------------------
l_wait_100ms:
	push	R3
	push	R4
	si	SP, #4
	bald	g_hshk_get_time
	mv	X1, SP
	l	R3, 4(X1)
l_wait_100ms_poll:
	bald	g_hshk_get_time
	mv	X1, SP
	l	R0, 4(X1)
	s	R0, R3
	cwi	R0, #WAIT_100MS_TICKS, LPZ
	b	l_wait_100ms_poll
	ai	SP, #4
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; LED バッファ 14 ワードを 0 クリア
; -------------------------------------------------------
l_led_buf_clear:
	mvwi	R1, #led_buf
	mvwi	R2, #LED_WORDS
	eor	R0, R0
l_led_clr_lp:
	str	R0, (R1)+
	si	R2, #1, Z
	b	l_led_clr_lp
	ret

	.area	_DATA		(REL,CON)
msg_ready:
	.dw	"ARE YOU READY?"
msg_go:
	.dw	"GO"

; 7セグ HEX font（a..g,dp = bit0..7）
hex_seg_tab:
	.dw	0x3f	; 0
	.dw	0x06	; 1
	.dw	0x5b	; 2
	.dw	0x4f	; 3
	.dw	0x66	; 4
	.dw	0x6d	; 5
	.dw	0x7d	; 6
	.dw	0x07	; 7
	.dw	0x7f	; 8
	.dw	0x6f	; 9
	.dw	0x77	; A
	.dw	0x7c	; B
	.dw	0x39	; C
	.dw	0x5e	; D
	.dw	0x79	; E
	.dw	0x71	; F

	.area	_WORK		(REL,NOLOAD)
turns_left:
	.ds	1
score_ok:
	.ds	1
score_ng:
	.ds	1
target_val:
	.ds	1
target_pos:
	.ds	1
poll_t0:
	.ds	1

; g_bios_hex_key_get の受け取り先（8ワード、各下位8bit）
key_cols:
	.ds	8

; g_bios_led_display 用（7seg 12 + bullet 2）
led_buf:
	.ds	LED_SEGS
led_bullet:
	.ds	2


