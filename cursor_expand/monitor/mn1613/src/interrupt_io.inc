; 割り込み関連 IO ポート定義
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc

RESET_VECTOR	.equ	0x00	; リセット時 IC 開始アドレス

INTERRUPT_BUSY	.equ	0x20	; 割り込み処理中フラグ Bit0
INT_CAUSE	.equ	0x21	; 割り込み要因 Bit0-2（ハンドシェイク=2）

; 割り込み要因番号
INT_CAUSE_TIMER0	.equ	0
INT_CAUSE_TIMER1	.equ	1
INT_CAUSE_HSHK		.equ	2
