; ハンドシェイク用IOポート定義（CPUボード視点）
; 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc
;
; 割り込みポート（INTERRUPT_BUSY / INT_CAUSE / INT_CAUSE_HSHK）は
; interrupt_io.inc と共有。二重 .equ を避けるため include する。
; memmap.inc は _VECTOR/_CODE の .org を含むのでここからは include しない。
	.include "../interrupt_io.inc"

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

; INT_CAUSE_HSHK は interrupt_io.inc 側の定義を使用

HSHK_OK		.equ	0x00
HSHK_NG		.equ	0x01
HSHK_NG_OTHER	.equ	0x02

; モード設定（10h）: 0=モニター / 1=フリー
HSHK_MODE_MONITOR	.equ	0
HSHK_MODE_FREE		.equ	1

; CPU→IO コマンド（HandShake.mdc「コマンド概要」）
HSHK_CMD_MODE_SET	.equ	0x10
HSHK_CMD_HEX_KEY	.equ	0x11
HSHK_CMD_PC_KEY		.equ	0x12
HSHK_CMD_LED_DISPLAY	.equ	0x13
HSHK_CMD_BEEP		.equ	0x14
HSHK_CMD_TIMER_SET	.equ	0x15
HSHK_CMD_GET_TIME	.equ	0x16
HSHK_CMD_UNDEF_LED	.equ	0x17
HSHK_CMD_LCD_CTRL	.equ	0x19
HSHK_CMD_LCD_TEXT	.equ	0x1A

; 未定義命令LED（17h）: Bit0 0=消灯 / 1=点灯
HSHK_UNDEF_LED_OFF	.equ	0
HSHK_UNDEF_LED_ON	.equ	1

; 16進キー入力取得（11h）: 列 0–7。バッファは 1 ワード 1 バイト（下位 8bit）
HSHK_HEX_KEY_COLS	.equ	8

; LED表示依頼（13h）: 7seg×12 + 砲弾×2。バッファは 1 ワード 1 バイト（下位 8bit）
HSHK_LED_SEG_LEN	.equ	12
HSHK_LED_DATA_LEN	.equ	14

; LCD制御（19h）種別
HSHK_LCD_CTRL_CLEAR		.equ	0
HSHK_LCD_CTRL_HOME		.equ	1
HSHK_LCD_CTRL_DISPLAY_CTRL	.equ	2
HSHK_LCD_CTRL_SET_CURSOR	.equ	3

; LCD文字列表示（1Ah）: 1回あたり最大16文字
HSHK_LCD_TEXT_MAX	.equ	16

; IO→CPU コマンド（HandShake.mdc「レトロCPUボード <- 制御・I/Oボード」）
HSHK_CMD_BREAK_MEM_IO_SET	.equ	0x40
HSHK_CMD_BREAK_MEM_IO_CLR	.equ	0x41
HSHK_CMD_BREAK_INST_SET		.equ	0x42
HSHK_CMD_BREAK_INST_CLR		.equ	0x43
HSHK_CMD_CPU_STATUS_GET		.equ	0x48
HSHK_CMD_EXEC			.equ	0x49
HSHK_CMD_MEM_READ		.equ	0x50
HSHK_CMD_MEM_WRITE		.equ	0x51
HSHK_CMD_IO_READ		.equ	0x52
HSHK_CMD_IO_WRITE		.equ	0x53
HSHK_CMD_BREAK_HIST_GET		.equ	0x60
HSHK_CMD_IO_BASE		.equ	0x40
HSHK_CMD_IO_LAST		.equ	0x60
HSHK_CMD_IO_LIMIT		.equ	0x61

; IO→CPU コマンド後の残り受信バイト（cmd 除く）
HSHK_IRQ_PAY_40		.equ	9
HSHK_IRQ_PAY_41		.equ	1

; アドレスブレイク（40h/41h）スロット表（_WORK、1 スロット 6 ワード × 6）
HSHK_AB_SLOTS		.equ	6
HSHK_AB_SLOT_WORDS	.equ	6
HSHK_AB_TBL_WORDS	.equ	HSHK_AB_SLOTS * HSHK_AB_SLOT_WORDS
HSHK_AB_W_ENA		.equ	0
HSHK_AB_W_FLAGS		.equ	1
HSHK_AB_W_COUNT		.equ	2
HSHK_AB_W_ADDR_HI	.equ	3
HSHK_AB_W_ADDR_LO	.equ	4
HSHK_AB_W_DATA		.equ	5
HSHK_AB_F_IO		.equ	0x01
HSHK_AB_F_WRITE		.equ	0x02
HSHK_AB_F_HIST		.equ	0x20
HSHK_IRQ_PAY_42		.equ	5
HSHK_IRQ_PAY_43		.equ	1
HSHK_IRQ_PAY_49		.equ	4
HSHK_IRQ_PAY_50		.equ	8
HSHK_IRQ_PAY_51		.equ	8
HSHK_IRQ_STATUS_BYTES	.equ	0x16
HSHK_MEM_BLOCK		.equ	256

; CPU状態構造体（ワードオフセット。R0 = 先頭。48h 線上はここから 0x16 バイト）
HSHK_REG_W_R0		.equ	0
HSHK_REG_W_R1		.equ	1
HSHK_REG_W_R2		.equ	2
HSHK_REG_W_R3		.equ	3
HSHK_REG_W_R4		.equ	4
HSHK_REG_W_SP		.equ	5
HSHK_REG_W_STR		.equ	6
HSHK_REG_W_IC		.equ	7
HSHK_REG_W_CSBR_SSBR	.equ	8
HSHK_REG_W_TSR0_1	.equ	9
HSHK_REG_W_NPP_IISR	.equ	10
HSHK_REG_WORDS		.equ	11

; レベル2割り込み退避（MN1613_CPUボードメモリ_IOマップ.mdc 0004/0005）
HSHK_L2_STR_SAVE	.equ	4
HSHK_L2_IC_SAVE		.equ	5

; ENA=0 チェック: 最大10回。待ちは厳密な us ではなく粗いスピン（乱数でばらす）
HSHK_ENA0_RETRY		.equ	10
HSHK_DELAY_MIN		.equ	8
HSHK_DELAY_MASK		.equ	0x3f
HSHK_WAIT_MAX		.equ	0xffff

; LED 内部ラッチのアドレス
HSHK_LED_7SEG_01	.equ	0
HSHK_LED_7SEG_23	.equ	1
HSHK_LED_7SEG_45	.equ	2
HSHK_LED_7SEG_67	.equ	3
HSHK_LED_7SEG_89	.equ	4
HSHK_LED_7SEG_AB	.equ	5
HSHK_LED_7SEG_CD	.equ	6
HSHK_LED_BUL_0F		.equ	7
