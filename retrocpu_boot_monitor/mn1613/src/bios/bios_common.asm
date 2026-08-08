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
	.org	0x0008
; --- _SYS_PAGE0: BIOS 乱数（bios_common.asm） ---
GL_RND_SEED:	.ds	1	; 乱数種（gl_rnd_init / gl_get_rnd）
		.ds	1	; GL_HSHK_RECV_DATA（handshake_io.inc .equ 0x0009）
