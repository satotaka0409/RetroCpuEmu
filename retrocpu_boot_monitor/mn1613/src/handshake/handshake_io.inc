; ハンドシェイク用IOポート定義（CPUボード視点）
; 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc
;
; 割り込みポート（INTERRUPT_BUSY / INT_CAUSE / INT_CAUSE_HSHK）は
; interrupt_io.inc と共有。二重 .equ を避けるため include する。
; memmap.inc は .org を含むのでここからは include しない（各 .asm を個別アセンブルしてリンクする）。
	.include "../interrupt_io.inc"

; ゼロページ _SYS_PAGE0（0x0008=GL_RND_SEED は bios_common.asm）
GL_HSHK_RECV_DATA	.equ	0x0009

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

; CPU→IO コマンド（HandShake.mdc「コマンド概要」）
HSHK_CMD_TIMER_SET	.equ	0x19

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
HSHK_IRQ_PAY_42		.equ	5
HSHK_IRQ_PAY_43		.equ	1
HSHK_IRQ_PAY_49		.equ	4
HSHK_IRQ_STATUS_BYTES	.equ	0x28

; ENA=0 チェック: 最大10回
HSHK_ENA0_RETRY	.equ	10
HSHK_DELAY_50US	.equ	25
HSHK_DELAY_SPAN_MASK	.equ	0x1f
HSHK_WAIT_MAX	.equ	0xffff
