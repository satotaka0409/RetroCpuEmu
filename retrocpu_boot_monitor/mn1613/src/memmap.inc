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
; --- SYSTEM: システムページ0エリア（0x0008 GL_RND_SEED / 0x0009 GL_HSHK_RECV_DATA）
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
