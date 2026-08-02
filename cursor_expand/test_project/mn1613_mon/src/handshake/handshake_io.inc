; ハンドシェイク用IOポート定義
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc / HandShake.mdc

; 制御信号ポート（同一アドレス、ビットで区別）
HSHK_CTRL	.equ	0x22
HSHK_ACK	.equ	0x22	; Bit0  ACK/BUSY
HSHK_DENA	.equ	0x22	; Bit1  データ有効
HSHK_DACK	.equ	0x22	; Bit2  データ受信応答
; REQ_0 は IOマップ未記載のため制御ポート Bit3 に割り当て
HSHK_REQ0	.equ	0x22	; Bit3  CPU->IO 要求（CPU出力）
; REQ_1 はレベル2割り込み入力。ポーリング用に Bit4 を割り当て
HSHK_REQ1	.equ	0x22	; Bit4  IO->CPU 要求（CPU入力）

HSHK_DATA	.equ	0x23	; 送受信データ Bit0-7

; 制御ポート ビットマスク（LSB=Bit0、interrupt.asm の INT_CAUSE と同様）
HSHK_ACK_BIT	.equ	0x01
HSHK_DENA_BIT	.equ	0x02
HSHK_DACK_BIT	.equ	0x04
HSHK_REQ0_BIT	.equ	0x08
HSHK_REQ1_BIT	.equ	0x10

; 割り込み要因
INT_CAUSE_HSHK	.equ	2

; 戻り値
HSHK_OK		.equ	0x00
HSHK_NG		.equ	0x01

; ACK=0 チェック: 50us～100us（ランダム）× 最大10回 ≒ 最大1ms（HandShake.mdc）
HSHK_ACK0_RETRY	.equ	10
; 約50us 相当の待機ループ回数（CPUクロックに応じて調整）
HSHK_DELAY_50US	.equ	25
; 追加待機の乱数マスク（0～31 ループ ≒ 最大約 +50us 超）
HSHK_DELAY_SPAN_MASK	.equ	0x1f
; ACK/DACK/DENA 待ちの最大ポーリング回数
HSHK_WAIT_MAX	.equ	0xffff
