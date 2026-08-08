; -------- begin ../retrocpu_boot_monitor/mn1613/src/start.asm
; start.asm
; amalgam / Intel HEX 用エントリ。include-once で単一モジュール化する。

; .include main.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/main.asm
; mn1613_mon
; MN1613のモニタープログラム
; リセット後、このプログラムからMN1613のプログラムを起動する
;
; 配置は memmap.inc（.area _VECTOR / _CODE / _DATA / _WORK / スタック）に従う。

; .include interrupt_io.inc
; -------- begin ../retrocpu_boot_monitor/mn1613/src/interrupt_io.inc
; 割り込み関連 IO ポート定義
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc

INTERRUPT_BUSY	.equ	0x20	; 割り込み処理中フラグ Bit0
INT_CAUSE	.equ	0x21	; 割り込み要因 Bit0-2（ハンドシェイク=2）

; 割り込み要因番号
INT_CAUSE_TIMER0	.equ	0
INT_CAUSE_TIMER1	.equ	1
INT_CAUSE_HSHK		.equ	2

; -------- end interrupt_io.inc

; .include memmap.inc
; -------- begin ../retrocpu_boot_monitor/mn1613/src/memmap.inc
; MN1613 CPUボードのメモリ配置とモニタ作業領域の割り当て
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc
;
; 2階ボードはオールRAMだが、コーディング上は ROM / RAM を分けて扱う。
;   0100-0107  _VECTOR  割り込みベクタ（PSW / IC。DMA でロードする定数）
;   0200-16FF  _CODE    コード（ROM 相当。実行中は書き換えない）
;              _DATA    値あり定数・テーブル（ROM。`.word` / `.dw`）
;              _WORK    モニタ作業領域（RAM。`.ds` のみ。初期値は実行時に書く）
;   1800-F7FF  ユーザ領域
;   F800-FFFF  スタック（SP は FFFF から下方へ伸びる）

INT_VECTOR_BASE	.equ	0x0100
STACK_TOP	.equ	0xffff

; --- PAGE0: ゼロページエリア
; --- SYSTEM: システムページ0エリア
	.area	_SYS_PAGE0		(ABS,NOLOAD)
	.org	0x0008
; --- USER: ユーザページ0エリア
	.area	_USR_PAGE0		(ABS,NOLOAD)
	.org	0x0040

	.area	_VECTOR		(ABS,OVR)
	.org	0x0100

	.area	_CODE		(REL,CON)
	.org	0x0200
	.area	_DATA		(REL,CON)
	.area	_WORK		(REL,NOLOAD)

; -------- end memmap.inc


	.global gl_int_handler
	.global gl_main

; --- _WORK: BIOS 乱数（bios_common.asm） ---
GL_RND_DEFAULT_SEED	.equ	0x1234

; 割り込みベクタ（ロード時に書き込む定数）
	.area	_VECTOR		(ABS,OVR)
	.org	INT_VECTOR_BASE
	.dw	0b11100000		; STR
	.dw	int0_handler

	.org	INT_VECTOR_BASE + 2
	.dw	0b11100000		; STR
	.dw	int1_handler

	.org	INT_VECTOR_BASE + 4
	.dw	0b11100000		; STR
	.dw	gl_int_handler		; IC

	.org	INT_VECTOR_BASE + 6
	.dw	0b11100000		; STR
	.dw	int3_handler

	.area	_CODE		(REL,CON)
gl_main:
;	スタック初期化
	mvwi	SP, #STACK_TOP
; 	割り込み許可
	mvi	STR, #0b11100000
;       乱数初期化
	mvwi	R0, #GL_RND_DEFAULT_SEED
	bald	gl_rnd_init
;       HALT
	h
; --- INT0 割り込みハンドラ ---
int0_handler:
	lpsw	0

; --- INT1 割り込みハンドラ ---
int1_handler:
	lpsw	1

; --- INT3 割り込みハンドラ (ソフト割り込み) ---
int3_handler:
	lpsw	3

; -------- end main.asm

; .include interrupt.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/interrupt.asm
; mn1613_mon
; 割り込みハンドラー

; .include interrupt_io.inc
; [skip already included] interrupt_io.inc


; ハンドラは _CODE、要因テーブル（値あり）は _DATA（ROM）
	.area	_CODE		(REL,CON)

	.global gl_int_handler
	.global gl_handshake_interrupt_handler

; 割り込みハンドラー
gl_int_handler:
	; 割り込みハンドラー
	pshm
	; 割り込み処理実行中フラグをセット
	mvwi	R0, #1
	wt	R0, INTERRUPT_BUSY

	; IO命令で割り込み要因を取得
	rd	R0, INT_CAUSE
	andi	R0, #0b00000111
	; 左1Bitシフト
	sl	R0
	; interrupt_sub_func のアドレスを取得
	mvwi	X0, #interrupt_sub_func
	a	X0, R0
	; 広域サブルーチンコール
	balr	(R3)

	; 割り込み処理実行中フラグをクリア
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	popm
	; 割り込み処理を終了
	lpsw	2

; タイマー0割り込みハンドラー
; IOボードのタイマー（ハンドシェイク 19h で設定）満了で呼ばれる
timer0_interrupt_handler:
	ret

; タイマー1割り込みハンドラー
timer1_interrupt_handler:
	ret

	.area	_DATA		(REL,CON)
; 割り込み要因ごとのハンドラー（ROM 定数テーブル）
interrupt_sub_func:
	; 割り込み要因0 タイマー0
	.dw	0  					; CSBR=0
	.dw	timer0_interrupt_handler
	; 割り込み要因1 タイマー1
	.dw	0  					; CSBR=0
	.dw	timer1_interrupt_handler
	; 割り込み要因2 ハンドシェイク
	.dw	0  					; CSBR=0
	.dw	gl_handshake_interrupt_handler



; -------- end interrupt.asm

; .include handshake/handshake_main.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/handshake/handshake_main.asm
; handshake_main.asm
; IO→CPU ハンドシェイク割り込み（INT_CAUSE=2）
; 根拠: HandShake.mdc「レトロCPUボード <- 制御・I/Oボード」
;
; gl_int_handler から BALR で呼ばれるので、戻りは RETL。
; 受理 → コマンド 1 バイト受信 → テーブルで分岐 → finalize。

; .include handshake_common.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/handshake/handshake_common.asm
; handshake_common.asm
; MN1613 CPUボード側ハンドシェイク（アセンブラ実装）
; 根拠: HandShake.mdc（HSHK_ENA / IN_DATA / OUT_DATA）
;
; CPU -> IO:
;   gl_hshk_initiate_send -> gl_hshk_send_byte*N -> gl_hshk_finalize_send
; IO -> CPU（割り込み入口）:
;   gl_hshk_accept_request -> gl_hshk_recv_byte*N -> gl_hshk_finalize_recv
;
; 1バイト: DENA 0→1 → DACK 0→1 → DENA 1→0 → DACK 1→0
;
; 引数は第1=R0、第2=R1、第3以降はスタック（asm-rules.mdc の呼び出し規約）。
; 作業変数は _WORK（RAM）に置くため、初期値は実行時に書く。
; ENA0 待ちの乱数は bios_common.asm の gl_get_rnd（M系列）を使う。

; .include handshake_io.inc
; -------- begin ../retrocpu_boot_monitor/mn1613/src/handshake/handshake_io.inc
; ハンドシェイク用IOポート定義（CPUボード視点）
; 根拠: HandShake.mdc / MN1613_CPUボードメモリ_IOマップ.mdc
;
; 割り込みポート（INTERRUPT_BUSY / INT_CAUSE / INT_CAUSE_HSHK）は
; interrupt_io.inc と共有。amalgam 時の二重 .equ を避けるため include する。
; .include ../interrupt_io.inc
; [skip already included] interrupt_io.inc


; 作業領域（_WORK / RAM）は memmap.inc の .area _WORK + .ds で確保する
; .include ../memmap.inc
; [skip already included] memmap.inc


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

; -------- end handshake_io.inc

; .include ../bios/bios_common.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/bios/bios_common.asm
; bios_common.asm
; BIOS 共通ルーチン（乱数など）
;
; 引数は第1=R0、第2=R1（asm-rules.mdc の呼び出し規約）。
; 種はゼロページ _SYS_PAGE0 の GL_RND_SEED（L/ST *）。初期値は gl_rnd_init で書く。

	.area	_CODE		(REL,CON)

	.global gl_rnd_init
	.global gl_get_rnd

; 16bit Galois LFSR（M系列）のタップ
; 原始多項式 x^16 + x^14 + x^13 + x^11 + 1 → 0xB400
GL_RND_TAP	.equ	0xB400

; -------------------------------------------------------
; 乱数初期化
; @param R0 - 種（16bit。0 はロックするので 1 にする）
; @Destruction R0
; -------------------------------------------------------
gl_rnd_init:
	mv	R0, R0, NZ
	mvi	R0, #1
	st	R0, *GL_RND_SEED
	ret

; -------------------------------------------------------
; 乱数取得（M系列、1〜0xFFFF、周期 2^16-1）
; @note 右シフト Galois LFSR。LSB=1 のとき 0xB400 を XOR
; @return R0 - 乱数値
; @Destruction R0
; -------------------------------------------------------
gl_get_rnd:
	l	R0, *GL_RND_SEED
	mv	R0, R0, NZ
	mvi	R0, #1
	sr	R0, RE
	tbit	STR, #0, Z
	eori	R0, #GL_RND_TAP
	st	R0, *GL_RND_SEED
	ret

	.area	_SYS_PAGE0		(ABS,NOLOAD)
; --- _SYS_PAGE0: BIOS 乱数（bios_common.asm） ---
GL_RND_SEED:	.ds	1	; 乱数種（gl_rnd_init / gl_get_rnd）

; -------- end bios_common.asm


	.area	_CODE		(REL,CON)

	.global gl_hshk_initiate_send
	.global gl_hshk_send_byte
	.global gl_hshk_finalize_send
	.global gl_hshk_accept_request
	.global gl_hshk_recv_byte
	.global gl_hshk_finalize_recv
	.global gl_hshk_wait_ena_delay
	.global gl_hshk_wait_req1_1

; -------------------------------------------------------
; ENA=0 チェック用の待機（50us～100us ランダム近似）
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_wait_ena_delay:
	bald	gl_get_rnd
	andi	R0, #HSHK_DELAY_SPAN_MASK
	awi	R0, #HSHK_DELAY_50US
hshk_wad_lp:
	si	R0, #1, Z
	b	hshk_wad_lp
	ret

; -------------------------------------------------------
; HSHK_ENA==0 を確認する
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_ena0:
	mvwi	R1, #HSHK_ENA0_RETRY
hshk_we0_lp:
	bald	gl_hshk_wait_ena_delay
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT, Z
	b	hshk_we0_busy
	mvwi	R0, #HSHK_OK
	ret
hshk_we0_busy:
	si	R1, #1, Z
	b	hshk_we0_lp
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_ENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_ENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_ena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_ena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT
	c	R0, R2, Z
	b	hshk_ena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_ena_cont:
	si	R1, #1, Z
	b	hshk_ena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DACK が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DACK_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_dack:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_dack_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DACK_BIT
	c	R0, R2, Z
	b	hshk_dack_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_dack_cont:
	si	R1, #1, Z
	b	hshk_dack_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_dena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_dena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DENA_BIT
	c	R0, R2, Z
	b	hshk_dena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_dena_cont:
	si	R1, #1, Z
	b	hshk_dena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 0 になるまで待つ
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_req1_0:
	mvwi	R1, #HSHK_WAIT_MAX
hshk_req1_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	hshk_req1_cont
	mvwi	R0, #HSHK_OK
	ret
hshk_req1_cont:
	si	R1, #1, Z
	b	hshk_req1_lp
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 1 になるまで待つ
; @note 割り込みを使わず IO→CPU 依頼を待つ（BIOS の応答受信）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_wait_req1_1:
	mvwi	R1, #HSHK_WAIT_MAX
hshk_req1s_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	hshk_req1s_ok
	si	R1, #1, Z
	b	hshk_req1s_lp
	mvwi	R0, #HSHK_NG
	ret
hshk_req1s_ok:
	mvwi	R0, #HSHK_OK
	ret

; -------------------------------------------------------
; 制御ポート RMW: ビットセット
; @param R0 - セットするビットマスク
; @Destruction R0, R1
; -------------------------------------------------------
hshk_ctrl_set:
	mv	R1, R0
	rd	R0, HSHK_CTRL
	or	R0, R1
	wt	R0, HSHK_CTRL
	ret

; -------------------------------------------------------
; 制御ポート RMW: ビットクリア
; @param R0 - クリアするビットマスク
; @Destruction R0, R1
; -------------------------------------------------------
hshk_ctrl_clr:
	mv	R1, R0
	eori	R1, #0xffff
	rd	R0, HSHK_CTRL
	and	R0, R1
	wt	R0, HSHK_CTRL
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク開始
; @note ENA=0確認 → DENA=0 → REQ_0=1 → ENA=1待ち → REQ_0=0
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_initiate_send:
	bald	hshk_wait_ena0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_set

	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_wait_ena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_OK
	ret

hshk_init_send_fail:
	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO 1バイト送信
; @param R0 - 送信バイト（下位8bit）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_send_byte:
	wt	R0, HSHK_IN_DATA

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_set

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_wait_dack
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_send_fail

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr

	eor	R0, R0
	bald	hshk_wait_dack
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_send_fail

	mvwi	R0, #HSHK_OK
	ret

hshk_send_fail:
	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_finalize_send:
	eor	R0, R0
	bald	hshk_wait_ena
	ret

; -------------------------------------------------------
; IO -> CPU 依頼受理（割り込みハンドラから）
; @note DACK=0 → ENA=1 → REQ_1=0待ち
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_accept_request:
	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_set

	bald	hshk_wait_req1_0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_accept_fail

	mvwi	R0, #HSHK_OK
	ret

hshk_accept_fail:
	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU 1バイト受信
; @note 受信データは _WORK の GL_HSHK_RECV_DATA に格納
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_recv_byte:
	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_wait_dena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_recv_fail

	rd	R0, HSHK_OUT_DATA
	andi	R0, #0x00ff
	std	R0, GL_HSHK_RECV_DATA

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_set

	eor	R0, R0
	bald	hshk_wait_dena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_recv_fail2

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_OK
	ret

hshk_recv_fail2:
	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr
hshk_recv_fail:
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_finalize_recv:
	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_OK
	ret

	.area	_WORK		(REL,NOLOAD)
; --- _WORK: ハンドシェイク（handshake_common.asm） ---
GL_HSHK_RECV_DATA:	.ds	1	; 受信 1 バイト

; -------- end handshake_common.asm


	.area	_CODE		(REL,CON)

	.global gl_handshake_interrupt_handler

; -------------------------------------------------------
; レベル2割り込み: ハンドシェイク要因
; @Destruction R0, R1
; -------------------------------------------------------
gl_handshake_interrupt_handler:
	bald	gl_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_irq_fail_accept

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_irq_fail_recv

	ld	R0, GL_HSHK_RECV_DATA
	andi	R0, #0x00ff
	cwi	R0, #HSHK_CMD_IO_BASE, M
	b	hshk_irq_ge_base
	b	hshk_irq_fin
hshk_irq_ge_base:
	cwi	R0, #HSHK_CMD_IO_LIMIT, PZ
	b	hshk_irq_dispatch
	b	hshk_irq_fin

hshk_irq_dispatch:
	swi	R0, #HSHK_CMD_IO_BASE
	sl	R0, RE
	mvwi	X0, #hshk_irq_cmd_tab
	a	X0, R0
	balr	(R3)

hshk_irq_fin:
	bald	gl_hshk_finalize_recv
	retl
hshk_irq_fail_accept:
	retl

hshk_irq_fail_recv:
	bald	gl_hshk_finalize_recv
	retl

; -------------------------------------------------------
; R0 バイト受信して捨てる
; @param R0 - バイト数
; @Destruction R0, R1
; -------------------------------------------------------
hshk_irq_recv_n:
	push	R2
	mv	R2, R0
hshk_irq_rn_lp:
	mv	R0, R2, Z
	b	hshk_irq_rn_go
	pop	R2
	ret
hshk_irq_rn_go:
	bald	gl_hshk_recv_byte
	si	R2, #1
	b	hshk_irq_rn_lp

; -------------------------------------------------------
; 0 を R0 バイト送る
; @param R0 - バイト数
; @Destruction R0, R1
; -------------------------------------------------------
hshk_irq_send_zeros:
	push	R2
	mv	R2, R0
hshk_irq_sz_lp:
	mv	R0, R2, Z
	b	hshk_irq_sz_go
	pop	R2
	ret
hshk_irq_sz_go:
	eor	R0, R0
	bald	gl_hshk_send_byte
	si	R2, #1
	b	hshk_irq_sz_lp

; -------------------------------------------------------
; 未実装コマンド（ペイロードは読まず NG も返さない）
; -------------------------------------------------------
hshk_irq_unknown:
	retl

; 40h メモリ/IOブレイク設定
hshk_irq_40:
	mvwi	R0, #HSHK_IRQ_PAY_40
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 41h メモリ/IOブレイク解除
hshk_irq_41:
	mvwi	R0, #HSHK_IRQ_PAY_41
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 42h 命令ブレイク設定
hshk_irq_42:
	mvwi	R0, #HSHK_IRQ_PAY_42
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 43h 命令ブレイク解除
hshk_irq_43:
	mvwi	R0, #HSHK_IRQ_PAY_43
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

; 48h CPU状態取得（中身は cpu_status.asm へ移す想定。今は 0 埋め）
hshk_irq_48:
	mvwi	R0, #HSHK_IRQ_STATUS_BYTES
	bald	hshk_irq_send_zeros
	bald	gl_hshk_recv_byte
	retl

; 49h 実行指示
hshk_irq_49:
	mvwi	R0, #HSHK_IRQ_PAY_49
	bald	hshk_irq_recv_n
	mvwi	R0, #HSHK_NG
	bald	gl_hshk_send_byte
	retl

	.area	_DATA		(REL,CON)
; IO→CPU コマンド 0x40–0x60（1 エントリ = CSBR + ハンドラ、BALR 用）
hshk_irq_cmd_tab:
	.dw	0
	.dw	hshk_irq_40			; 40
	.dw	0
	.dw	hshk_irq_41			; 41
	.dw	0
	.dw	hshk_irq_42			; 42
	.dw	0
	.dw	hshk_irq_43			; 43
	.dw	0
	.dw	hshk_irq_unknown		; 44
	.dw	0
	.dw	hshk_irq_unknown		; 45
	.dw	0
	.dw	hshk_irq_unknown		; 46
	.dw	0
	.dw	hshk_irq_unknown		; 47
	.dw	0
	.dw	hshk_irq_48			; 48
	.dw	0
	.dw	hshk_irq_49			; 49
	.dw	0
	.dw	hshk_irq_unknown		; 4A
	.dw	0
	.dw	hshk_irq_unknown		; 4B
	.dw	0
	.dw	hshk_irq_unknown		; 4C
	.dw	0
	.dw	hshk_irq_unknown		; 4D
	.dw	0
	.dw	hshk_irq_unknown		; 4E
	.dw	0
	.dw	hshk_irq_unknown		; 4F
	.dw	0
	.dw	hshk_irq_unknown		; 50
	.dw	0
	.dw	hshk_irq_unknown		; 51
	.dw	0
	.dw	hshk_irq_unknown		; 52
	.dw	0
	.dw	hshk_irq_unknown		; 53
	.dw	0
	.dw	hshk_irq_unknown		; 54
	.dw	0
	.dw	hshk_irq_unknown		; 55
	.dw	0
	.dw	hshk_irq_unknown		; 56
	.dw	0
	.dw	hshk_irq_unknown		; 57
	.dw	0
	.dw	hshk_irq_unknown		; 58
	.dw	0
	.dw	hshk_irq_unknown		; 59
	.dw	0
	.dw	hshk_irq_unknown		; 5A
	.dw	0
	.dw	hshk_irq_unknown		; 5B
	.dw	0
	.dw	hshk_irq_unknown		; 5C
	.dw	0
	.dw	hshk_irq_unknown		; 5D
	.dw	0
	.dw	hshk_irq_unknown		; 5E
	.dw	0
	.dw	hshk_irq_unknown		; 5F
	.dw	0
	.dw	hshk_irq_unknown		; 60

; -------- end handshake_main.asm

; .include handshake/handshake_timer.asm
; -------- begin ../retrocpu_boot_monitor/mn1613/src/handshake/handshake_timer.asm
; handshake_timer.asm
; タイマー設定（ハンドシェイク 19h）
; 根拠: HandShake.mdc「タイマー設定」/ boot_monitor.mdc「タイマー割り込み」
;
; 線上 送信 6B: 19h, タイマー番号, 周期H, 周期L, 回数H, 回数L → 受信 1B: status
; タイマーは IO ボード側にあり、番号 0 / 1 の 2 本。初期化直後は停止している。
; 周期 0 で停止、回数 0 で無限。
;
; 引数は第1=R0、第2=R1、第3以降はスタック（asm-rules.mdc の呼び出し規約）。
; R2-R4 は非破壊なので先頭で PUSH し、復帰前に逆順で POP する。
; 送信フレームはスタック上に確保する（_WORK は使わない）。

; .include handshake_common.asm
; [skip already included] handshake_common.asm


	.area	_CODE		(REL,CON)

	.global gl_bios_timer_set

BIOS_TIMER_FRAME_LEN	.equ	6

; -------------------------------------------------------
; タイマー設定（19h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @param R0 - タイマー番号（0 または 1）
; @param R1 - 周期 ms（16bit、0 で停止）
; @param S+2 - 回数（16bit、0 で無限）-スタック
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1
; -------------------------------------------------------
gl_bios_timer_set:
	push	R2
	push	R3
	push	R4

	; 第3引数（回数）。入口では S+2、3 PUSH 後は SP+5
	mv	X0, SP
	l	R2, 5(X0)

	; 送信フレーム 6 ワードをスタックに確保（SP+1 … SP+6）
	si	SP, #BIOS_TIMER_FRAME_LEN

	; 1 ワード 1 バイト、上位バイト先
	mv	X0, SP
	mv	R4, R0			; タイマー番号
	mvwi	R0, #HSHK_CMD_TIMER_SET
	st	R0, 1(X0)
	mv	R0, R4
	andi	R0, #0x00ff
	st	R0, 2(X0)
	bswp	R0, R1
	andi	R0, #0x00ff
	st	R0, 3(X0)
	mv	R0, R1
	andi	R0, #0x00ff
	st	R0, 4(X0)
	bswp	R0, R2			; R2 = 回数
	andi	R0, #0x00ff
	st	R0, 5(X0)
	mv	R0, R2
	andi	R0, #0x00ff
	st	R0, 6(X0)

	bald	gl_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	mv	X0, SP
	ai	X0, #1			; フレーム先頭
	mvwi	X1, #BIOS_TIMER_FRAME_LEN
bios_timer_send_lp:
	l	R0, 0(X0)
	bald	gl_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail
	ai	X0, #1
	si	X1, #1, Z
	b	bios_timer_send_lp

	bald	gl_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	; 応答 1 バイトは IO→CPU の転送で届く。割り込みを待たず REQ_1 をポーリングする
	bald	gl_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_fail

	bald	gl_hshk_recv_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	bios_timer_recv_fail

	bald	gl_hshk_finalize_recv

	ld	R0, GL_HSHK_RECV_DATA
	andi	R0, #0x00ff
	b	bios_timer_done

bios_timer_recv_fail:
	bald	gl_hshk_finalize_recv
bios_timer_fail:
	mvwi	R0, #HSHK_NG
bios_timer_done:
	ai	SP, #BIOS_TIMER_FRAME_LEN
	pop	R4
	pop	R3
	pop	R2
	ret

; -------- end handshake_timer.asm


; -------- end start.asm
