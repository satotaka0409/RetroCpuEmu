; ハンドシェイク用IOポート定義（CPUボード視点）
; 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc
;
; 割り込みポート（INTERRUPT_BUSY / INT_CAUSE / INT_CAUSE_HSHK）は
; interrupt_io.inc と共有。二重 .equ を避けるため include する。
; memmap.inc は _VECTOR/_BIOS の .org を含むのでここからは include しない。
	.include "../interrupt_io.inc"

; 制御信号ポート（方向分離）
HSHK_OUT_CTRL	.equ	0x22
; Bit0  HSHK_OUT_REQ（CPU→IO 要求・CPU出力）
; Bit1  HSHK_OUT_DENA（CPU→IO データ有効・CPU出力）
; Bit2  HSHK_IN_DACK（IO→CPU データ受信完了・CPU出力）

HSHK_OUT_DATA	.equ	0x23	; CPU→IO データ Bit0-7

HSHK_IN_CTRL	.equ	0x24
; Bit0  HSHK_IN_REQ（IO→CPU 要求・CPU入力）
; Bit1  HSHK_IN_DENA（IO→CPU データ有効・CPU入力）
; Bit2  HSHK_OUT_DACK（CPU→IO データ受信完了・CPU入力）

HSHK_IN_DATA	.equ	0x25	; IO→CPU データ Bit0-7

; ビットマスク（LSB=Bit0）
HSHK_OUT_REQ_BIT	.equ	0x01
HSHK_OUT_DENA_BIT	.equ	0x02
HSHK_IN_DACK_BIT	.equ	0x04

HSHK_IN_REQ_BIT		.equ	0x01
HSHK_IN_DENA_BIT	.equ	0x02
HSHK_OUT_DACK_BIT	.equ	0x04

; 互換エイリアス（旧名）
HSHK_CTRL	.equ	HSHK_OUT_CTRL

; INT_CAUSE_HSHK は interrupt_io.inc 側の定義を使用

HSHK_OK		.equ	0x00
HSHK_NG		.equ	0x01
HSHK_NG_OTHER	.equ	0x02

; モード設定（10h）: 0=モニター / 1=フリー
HSHK_MODE_MONITOR	.equ	0
HSHK_MODE_FREE		.equ	1

; CPU→IO コマンド（HandShake.mdc「コマンド概要」の並び）
HSHK_CMD_MODE_SET	.equ	0x10
HSHK_CMD_GET_TIME	.equ	0x11
HSHK_CMD_TIMER_SET	.equ	0x12
HSHK_CMD_UNDEF_LED	.equ	0x13
HSHK_CMD_HEX_KEY	.equ	0x14
HSHK_CMD_PC_KEY		.equ	0x15
HSHK_CMD_LED_DISPLAY	.equ	0x16
HSHK_CMD_LCD_CTRL	.equ	0x17
HSHK_CMD_LCD_TEXT	.equ	0x18
HSHK_CMD_BEEP		.equ	0x19
HSHK_CMD_BREAK_NOTIFY	.equ	0x1A
HSHK_CMD_STEP_NOTIFY	.equ	0x1B
HSHK_CMD_RTC_GET_RAW	.equ	0x1C
HSHK_CMD_TEMP_GET_RAW	.equ	0x1D
HSHK_CMD_LIGHT_GET_RAW	.equ	0x1E
HSHK_CMD_DISTANCE_GET_RAW	.equ	0x1F

; 未定義命令LED（13h）: Bit0 0=消灯 / 1=点灯
HSHK_UNDEF_LED_OFF	.equ	0
HSHK_UNDEF_LED_ON	.equ	1

; 16進キー入力取得（14h）: 列 0–7。バッファは 1 ワード 1 バイト（下位 8bit）
HSHK_HEX_KEY_COLS	.equ	8

; LED表示依頼（16h）: 7seg×12 + 砲弾×2。バッファは 1 ワード 1 バイト（下位 8bit）
HSHK_LED_SEG_LEN	.equ	12
HSHK_LED_DATA_LEN	.equ	14

; LCD制御（17h）種別
HSHK_LCD_CTRL_CLEAR		.equ	0
HSHK_LCD_CTRL_HOME		.equ	1
HSHK_LCD_CTRL_DISPLAY_CTRL	.equ	2
HSHK_LCD_CTRL_SET_CURSOR	.equ	3

; LCD文字列表示（18h）: 1回あたり最大16文字
HSHK_LCD_TEXT_MAX	.equ	16

; IO→CPU コマンド（HandShake.mdc 概要表の順。番号は方向ごとに独立）
HSHK_CMD_BREAK_MEM_IO_SET	.equ	0x10
HSHK_CMD_BREAK_MEM_IO_CLR	.equ	0x11
HSHK_CMD_EXEC			.equ	0x12
HSHK_CMD_MEM_READ		.equ	0x13
HSHK_CMD_MEM_WRITE		.equ	0x14
HSHK_CMD_IO_READ		.equ	0x15
HSHK_CMD_IO_WRITE		.equ	0x16
HSHK_CMD_BREAK_HIST_GET		.equ	0x17
HSHK_CMD_BREAK_RESUME		.equ	0x18
; 89h(TTY入力) は仕様予約。monitor IRQ ディスパッチは現状 10h-18h。
HSHK_CMD_IO_BASE		.equ	0x10
HSHK_CMD_IO_LAST		.equ	0x18
HSHK_CMD_IO_LIMIT		.equ	0x19
; 高位 API（80h-89h）→ 線上値（10h-19h）変換
HSHK_CMD_IO_HI_BASE		.equ	0x80
HSHK_CMD_IO_HI_LIMIT		.equ	0x8a
HSHK_CMD_IO_WIRE_BIAS		.equ	0x70
; 廃止（ディスパッチ範囲外。INT3 命令パッチ）
HSHK_CMD_BREAK_INST_SET		.equ	0x42
HSHK_CMD_BREAK_INST_CLR		.equ	0x43
HSHK_RESUME_RUN			.equ	0
HSHK_RESUME_STEP		.equ	1
HSHK_RESUME_LIMIT		.equ	2

; IO→CPU コマンド後の残り受信バイト（cmd 除く）
HSHK_IRQ_PAY_SET	.equ	9
HSHK_IRQ_PAY_CLR	.equ	1

; アドレスブレイク（10h/11h）スロット表（_WORK、1 スロット 6 ワード × 4）
HSHK_AB_SLOTS		.equ	4
HSHK_AB_SLOT_WORDS	.equ	6
HSHK_AB_TBL_WORDS	.equ	HSHK_AB_SLOTS * HSHK_AB_SLOT_WORDS
HSHK_AB_W_ENA		.equ	0
HSHK_AB_W_FLAGS		.equ	1
HSHK_AB_W_COUNT		.equ	2
HSHK_AB_W_ADDR_HI	.equ	3
HSHK_AB_W_ADDR_LO	.equ	4
HSHK_AB_W_DATA		.equ	5
HSHK_AB_F_IO		.equ	0x01
HSHK_AB_F_RD		.equ	0x02
HSHK_AB_F_WR		.equ	0x04
HSHK_AB_F_WRITE		.equ	0x04
HSHK_AB_F_COND		.equ	0x38
HSHK_AB_F_INST		.equ	0x40
HSHK_AB_F_HIST		.equ	0x80

; 履歴リング（HandShake 17h / breakpoint.mdc）。物理 3F000h＝SBR C + 論理 F000h
; 1 エントリ 33 ワード: 時刻4 + AFTER + PREV + レジスタ 11 + スタック 16
HSHK_BH_DEPTH		.equ	4
HSHK_BH_INDEX_MASK	.equ	3	; DEPTH-1（リング index）
HSHK_BH_ENTRY_WORDS	.equ	33
HSHK_BH_STACK_WORDS	.equ	16
HSHK_BH_SLOT_WORDS	.equ	HSHK_BH_DEPTH * HSHK_BH_ENTRY_WORDS	; 132
HSHK_BH_SBR		.equ	0x000C
HSHK_BH_BASE		.equ	0xF000
HSHK_BH_META_WORDS	.equ	3
HSHK_BH_META_TBL	.equ	HSHK_AB_SLOTS * HSHK_BH_META_WORDS
HSHK_BH_W_TIME		.equ	0
HSHK_BH_W_DATA		.equ	4
HSHK_BH_W_PREV		.equ	5
HSHK_BH_W_REGS		.equ	6
HSHK_BH_W_STACK		.equ	17	; NPP の次から 16 ワード
HSHK_BH_ENTRY_BYTES	.equ	66
; GL_BP_HIST_META（1 スロット 3 ワード）
HSHK_BH_MW_COUNT	.equ	0	; 有効件数（0–4）
HSHK_BH_MW_NEXT		.equ	1	; 次書込 index（最新は (NEXT-1) & 3）
HSHK_BH_MW_OVF		.equ	2	; Bit0=リングオーバフロー
; 比較器ヒットの入口スナップ（スタック。R0 が先頭。リエントラント）
HSHK_BP_SNAP_WORDS	.equ	6
HSHK_BP_SNAP_PREV	.equ	0	; 0034 生値
HSHK_BP_SNAP_R3		.equ	1
HSHK_BP_SNAP_R4		.equ	2
HSHK_BP_SNAP_TSR0	.equ	3
HSHK_BP_SNAP_TSR1	.equ	4
HSHK_BP_SNAP_SP		.equ	5	; ヒット直前のユーザ SP

HSHK_IRQ_PAY_EXEC	.equ	5
HSHK_IRQ_PAY_MEM	.equ	9
HSHK_IRQ_PAY_IO		.equ	3
HSHK_IRQ_PAY_HIST	.equ	1
HSHK_BH_ST_OVF		.equ	0x01	; メタ Bit0（線上には出さない）
HSHK_BH_HDR_CPU		.equ	10	; count, flags, n_stop, pad, addr32, histCount, pad
HSHK_IO_MAX		.equ	254
HSHK_IO_LIMIT		.equ	255

; レジスタ並び（17h 履歴／未定義命令スナップ。ワードオフセット）
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
HSHK_REG_W_NPP		.equ	10	; 上位 8bit=NPP。下位は未使用（線上は 1B）
HSHK_REG_WORDS		.equ	11

; レベル2割り込み退避（MN1613_CPUボードメモリ_IOマップ.mdc 0004/0005）
HSHK_L2_STR_SAVE	.equ	4
HSHK_L2_IC_SAVE		.equ	5

; ENA=0 チェック: 最大10回。待ちは 10us～30us 相当の粗いスピン（乱数でばらす）
HSHK_ENA0_RETRY		.equ	10
HSHK_DELAY_MIN		.equ	2
HSHK_DELAY_MASK		.equ	0x0f
HSHK_WAIT_MAX		.equ	0xffff

; 2バイト転送位相（GL_HSHK_PAIR）
HSHK_PAIR_RECV		.equ	0x0001
HSHK_PAIR_SEND		.equ	0x0002

; LED 内部ラッチのアドレス
HSHK_LED_7SEG_01	.equ	0
HSHK_LED_7SEG_23	.equ	1
HSHK_LED_7SEG_45	.equ	2
HSHK_LED_7SEG_67	.equ	3
HSHK_LED_7SEG_89	.equ	4
HSHK_LED_7SEG_AB	.equ	5
HSHK_LED_7SEG_CD	.equ	6
HSHK_LED_BUL_0F		.equ	7
