; ハンドシェイク用IOポート定義（CPUボード視点）
; 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc

; 割り込み関連
INTERRUPT_BUSY	.equ	0x20	; Bit0
INT_CAUSE	.equ	0x21	; Bit0-2

; 制御信号ポート（同一アドレス、ビットで区別）
HSHK_CTRL	.equ	0x22
; Bit0  HSHK_ENA（処理中／依頼受理）
; Bit1  HSHK_DENA
; Bit2  HSHK_DACK
; Bit3  HSHK_REQ_0（CPU→IO 要求・CPU出力）
; Bit4  HSHK_REQ_1（IO→CPU 要求・CPU入力／ポーリング）

HSHK_IN_DATA	.equ	0x23	; CPU→IO データ Bit0-7
HSHK_OUT_DATA	.equ	0x24	; IO→CPU データ Bit0-7

; ビットマスク（LSB=Bit0）
HSHK_ENA_BIT	.equ	0x01
HSHK_DENA_BIT	.equ	0x02
HSHK_DACK_BIT	.equ	0x04
HSHK_REQ0_BIT	.equ	0x08
HSHK_REQ1_BIT	.equ	0x10

INT_CAUSE_HSHK	.equ	2

HSHK_OK		.equ	0x00
HSHK_NG		.equ	0x01

; ENA=0 チェック: 最大10回
HSHK_ENA0_RETRY	.equ	10
HSHK_DELAY_50US	.equ	25
HSHK_DELAY_SPAN_MASK	.equ	0x1f
HSHK_WAIT_MAX	.equ	0xffff
