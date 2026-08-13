; 割り込み関連 IO ポート定義
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc

INTERRUPT_BUSY	.equ	0x20	; 割り込み処理中フラグ Bit0
INT_CAUSE	.equ	0x21	; 割り込み要因 Bit0-2（ハンドシェイク=2）

; 割り込み要因番号
INT_CAUSE_TIMER0	.equ	0
INT_CAUSE_TIMER1	.equ	1
INT_CAUSE_HSHK		.equ	2
INT_CAUSE_ADDR_BREAK	.equ	4

; CPLD 比較器（MN1613_CPUボードメモリ_IOマップ.mdc）
IO_BREAK_CTRL		.equ	0x30
IO_BREAK_ADDR_HI	.equ	0x31
IO_BREAK_ADDR_LO	.equ	0x32
IO_BREAK_HIT		.equ	0x33
IO_BREAK_PREV		.equ	0x34
