; MN1613 CPUボードのメモリ配置とモニタ作業領域の割り当て
; 根拠: MN1613_CPUボードメモリ_IOマップ.mdc
;
; 2階ボードはオールRAMだが、コーディング上は ROM / RAM を分けて扱う。
;   0100-0107  _VECTOR  割り込みベクタ（PSW / IC。DMA でロードする定数）
;   0108-16FF  _CODE    コード（ROM 相当。実行中は書き換えない）
;              _DATA    値あり定数・テーブル（ROM。`.word` / `.dw`）
;              _WORK    モニタ作業領域（RAM。`.ds` のみ。初期値は実行時に書く）
;                       アドレスブレイク表 GL_HSHK_ADDR_BREAK（8×6 ワード）
;                       履歴メタ GL_BP_HIST_META（8×3: 件数 / 次書込 / ovf）
;   1800-F7FF  ユーザ領域
;   F800-FFFF  スタック（SP は FFFF から下方へ伸びる）
;   3F000-3FFFF  ブレイク履歴エントリ（SBR C、論理 F000h。17h 形式 33 ワード×16×8）

INT_VECTOR_BASE	.equ	0x0100
STACK_TOP	.equ	0xffff

; malloc 初期化用定数
GL_ALLOC_DEFAULT_ADR	.equ	0xE000
GL_ALLOC_DEFAULT_SIZE	.equ	0x1800
; malloc2 初期化用定数
GL_ALLOC2_DEFAULT_ADR	.equ	0x0000
GL_ALLOC2_DEFAULT_SBR	.equ	0x4
GL_ALLOC2_DEFAULT_SIZE	.equ	0xF000

; --- PAGE0: ゼロページエリア（L / ST *label）
; --- SYSTEM: 0008h–003Fh。各 .asm は .ds のみ（.org 不要）。
;     sdld `-b _SYS_PAGE0=0x0010`（ワード 0008h）から CON 連結する。
;     bios_common（種＋ヒープ 6 ワード）→ handshake_led（ラッチ 14 ワード）
	.area	_SYS_PAGE0	(REL,NOLOAD)
	.org	0x0008
; --- USER: ユーザページ0エリア（sdld `-b _USR_PAGE0=0x0080`＝ワード 0040h）
	.area	_USR_PAGE0	(REL,NOLOAD)

	.area	_CODE		(REL,CON)
	.org	0x0100
	.area	_DATA		(REL,CON)
	.area	_WORK		(REL,NOLOAD)
