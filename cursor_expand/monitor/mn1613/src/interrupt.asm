; mn1613_mon
; 割り込みハンドラー

.include "interrupt_io.inc"

.global gl_int_handler
.global gl_handshake_interrupt_handler

; 割り込みハンドラー
gl_int_handler:
	; 割り込みハンドラー
	pshm
	; 割り込み処理実行中フラグをセット
	mvi	R0, 1
	wt	R0, INTERRUPT_BUSY

	; IO命令で割り込み要因を取得
	rd	R0, INT_CAUSE
	andi	R0, 0b00000111
	; 左1Bitシフト
	sl	R0
	; interrupt_sub_func のアドレスを取得
	mvwi	X0, interrupt_sub_func
	a	X0, R0
	; 広域サブルーチンコール
	balr	(X0)

	; 割り込み処理実行中フラグをクリア
	mvi	R0, 0
	wt	R0, INTERRUPT_BUSY
	popm
	; 割り込み処理を終了
	lpsw    2

; タイマー1割り込みハンドラー
timer1_interrupt_handler:
	ret

; タイマー1割り込みハンドラー
timer2_interrupt_handler:
	ret

; 割り込み要因ごとのハンドラー
interrupt_sub_func:
	; 割り込み要因0 タイマー0
	.dw	0  					; CSBR=0
	.dw	timer1_interrupt_handler
	; 割り込み要因1 タイマー1
	.dw	0  					; CSBR=0
	.dw	timer2_interrupt_handler
	; 割り込み要因2 ハンドシェイク
	.dw	0  					; CSBR=0
	.dw	gl_handshake_interrupt_handler


