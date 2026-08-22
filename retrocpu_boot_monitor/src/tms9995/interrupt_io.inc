; 割り込み関連 CRU / メモリマップド IO 定義
; 根拠: TMS9995_CPUボードメモリ_IOマップ.mdc
; INT1 = ハンドシェイク、INT2 = ブレイク / ステップ、INT3 = 内蔵タイマー
;
; CRU（ハンドシェイク・要因）:
;   0010 BUSY / 0011 INT1_CAUSE / 0012 INT2_CAUSE
;   0020..0027 ハンドシェイク制御・DATA ラッチ
; メモリ（FE80–FE87）:
;   比較器設定・ヒット・前回値・ステップ ENA/DELAY

INTERRUPT_BUSY_BIT	.equ	0x0010

; INT1 要因（1bit）。1=ハンドシェイク（タイマーは内蔵レベル3）
INT1_CAUSE_BIT		.equ	0x0011
INT1_CAUSE_HSHK		.equ	1

; INT2 要因（1bit）
INT2_CAUSE_BIT		.equ	0x0012
INT2_CAUSE_BREAK	.equ	0
INT2_CAUSE_STEP		.equ	1

; ハンドシェイク制御
HSHK_OUT_REQ_BIT	.equ	0x0020
HSHK_OUT_DENA_BIT	.equ	0x0021
HSHK_IN_DACK_BIT	.equ	0x0022
HSHK_OUT_DATA_BASE	.equ	0x0023
HSHK_IN_REQ_BIT		.equ	0x0024
HSHK_IN_DENA_BIT	.equ	0x0025
HSHK_OUT_DACK_BIT	.equ	0x0026
HSHK_IN_DATA_BASE	.equ	0x0027

; 比較器・ステップ（メモリマップド IO）
IO_BREAK_SLOT		.equ	0xFE80
IO_BREAK_CTRL		.equ	0xFE81
IO_BREAK_ADDR_HI	.equ	0xFE82
IO_BREAK_ADDR_LO	.equ	0xFE83
IO_BREAK_HIT		.equ	0xFE84
IO_BREAK_PREV		.equ	0xFE85
IO_STEP_BRK_ENA		.equ	0xFE86
IO_STEP_BRK_DELAY	.equ	0xFE87
; 1命令ステップ用の既定ディレイ値（次クロックからカウントダウン開始）
STEP_BRK_DELAY_1STEP	.equ	0x01

; FE81 制御バイト内のビット（マップの Bit3–6）
IO_BREAK_CTRL_ENA	.equ	0x08
IO_BREAK_CTRL_IO	.equ	0x10
IO_BREAK_CTRL_RDWR_SHIFT	.equ	5
