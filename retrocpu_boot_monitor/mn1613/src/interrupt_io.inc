; 割り込み関連 IO ポート定義
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc

INTERRUPT_BUSY	.equ	0x20	; 割り込み処理中フラグ Bit0
INT_CAUSE	.equ	0x21	; Bit0=INT1_CAUSE, Bit1-2=INT2_CAUSE

; INT1 要因（Bit0）
INT1_CAUSE_BREAK	.equ	0
INT1_CAUSE_STEP		.equ	1
INT1_CAUSE_MASK		.equ	0x01

; INT2 要因（Bit1-2）
INT2_CAUSE_TIMER	.equ	0	; 00
INT2_CAUSE_HSHK		.equ	2	; 01 → ポート値 0x02
INT2_CAUSE_MASK		.equ	0x06

; CPLD 比較器（MN1613_CPUボードメモリ_IOマップ.mdc）
IO_BREAK_CTRL		.equ	0x30
IO_BREAK_ADDR_HI	.equ	0x31
IO_BREAK_ADDR_LO	.equ	0x32
IO_BREAK_HIT		.equ	0x33
IO_BREAK_PREV		.equ	0x34

; ステップ実行ワンショット（比較器を使わない）
IO_STEP_BRK_ENA		.equ	0x36
IO_STEP_BRK_COM		.equ	0x37
; 既定トリガ: LPSW 2
STEP_BRK_COM_LPSW2	.equ	0x2006
