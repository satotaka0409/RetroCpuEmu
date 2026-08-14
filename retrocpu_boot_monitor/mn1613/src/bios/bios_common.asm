; bios_common.asm
; BIOS 共通ルーチン（乱数・ヒープ）
;
; 引数は第1=R0、第2=R1（asm-rules.mdc の呼び出し規約）。
; 種は _SYS_PAGE0 の GL_RND_SEED（.ds 1、L/ST *label）。初期値は g_rnd_init で書く。
; g_* は BALD / RET。コードはセグメント 0。拡張 SBR はデータ（malloc2 等）専用。
; ヒープは first-fit + 隣接 free 結合。ブロック先頭 2 ワードがヘッダ
; （サイズ／使用フラグ）。GL_ALLOC_* は CSBR、GL_ALLOC2_* は SBR+TSR0。

	.cpu	mn1613

	; CPU状態の退避領域（HSHK_REG_W_*）を使用するため
	; HandShake の IO 定義を取り込む
	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_rnd_init
	.global g_get_rnd
	.global g_mem_cpy
	.global g_malloc_init
	.global g_malloc
	.global g_free
	.global g_malloc2_init
	.global g_malloc2
	.global g_free2
	.global g_write_cpu_registers
	.global GL_RND_SEED
	.global GL_ALLOC_ADR
	.global GL_ALLOC_SIZE
	.global GL_ALLOC2_ADR
	.global GL_ALLOC2_SBR
	.global GL_ALLOC2_SIZE
	.global GL_BAL_TMP

; 16bit Galois LFSR（M系列）のタップ
; 原始多項式 x^16 + x^14 + x^13 + x^11 + 1 → 0xB400
GL_RND_TAP	.equ	0xB400

; -------------------------------------------------------
; 乱数初期化
; @param R0 - 種（16bit。0 はロックするので 1 にする）
; @Destruction R0
; -------------------------------------------------------
g_rnd_init:
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
g_get_rnd:
	l	R0, *GL_RND_SEED
	mv	R0, R0, NZ
	mvi	R0, #1
	sr	R0, RE
; @cp g_get_rnd
	tbit	STR, #0, Z
	eori	R0, #GL_RND_TAP
	st	R0, *GL_RND_SEED
; @cp g_get_rnd
	ret

; ヒープブロック: [+0]=ワード数（ヘッダ含む） [+1]=0 free / 1 used [+2…]=ユーザ
GL_HEAP_HDR	.equ	2
GL_HEAP_USED	.equ	1

; -------------------------------------------------------
; メモリコピー（BLK。TSR0:R1 → TSR1:R2、語数 R0）
; @param R0 - コピー元 A16–A17（物理ワードの上位 2bit。TSR は <<2）
; @param R1 - コピー元 A0–A15（論理ワードアドレス）
; @param R2 - 語数（0 なら何もしない）
; @param SP+2 - コピー先 A16–A17
; @param SP+3 - コピー先 A0–A15
; @Destruction なし
; -------------------------------------------------------
g_mem_cpy:
	pshm
	cpyb	R0, TSR0
	cpyb	R1, TSR1
	push	R0
	push	R1
	mv	X0, SP
	l	R0, 7(X0)		; 元 A16–A17
	andi	R0, #0x0003
	sl	R0, RE
	sl	R0, RE
	setb	R0, TSR0
	l	R1, 6(X0)		; 元 A0–A15
	l	R0, 9(X0)		; 先 A16–A17
	andi	R0, #0x0003
	sl	R0, RE
	sl	R0, RE
	setb	R0, TSR1
	l	R2, 10(X0)		; 先 A0–A15
	l	R0, 5(X0)		; 語数
	blk
	pop	R1
	pop	R0
	setb	R1, TSR1
	setb	R0, TSR0
	popm
	ret

; -------------------------------------------------------
; malloc 初期化（first-fit ヒープ）
; @param R0 - ヒープ先頭（ワードアドレス）
; @param R1 - ヒープサイズ（ワード数。2 未満なら確保不可）
; @Destruction なし
; -------------------------------------------------------
g_malloc_init:
	push	R3
	st	R0, *GL_ALLOC_ADR
	st	R1, *GL_ALLOC_SIZE
	cwi	R1, #GL_HEAP_HDR, LPZ
	b	l_minit_done
	mv	X0, R0
	st	R1, 0(X0)
	eor	R1, R1
; @cp g_malloc_init
	st	R1, 1(X0)
	l	R1, *GL_ALLOC_SIZE
l_minit_done:
	pop	R3
	ret
; -------------------------------------------------------
; malloc（ワード単位・first-fit）
; @param R0 - 欲しいワード数（1 以上。ヘッダ 2 ワードは含まない）
; @return R0 - ユーザ領域先頭。失敗は 0
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_malloc:
	push	R3
	push	R4
	mv	R1, R0
	mv	R1, R1, NZ
	b	l_m_fail
	ai	R1, #GL_HEAP_HDR
	c	R1, R0, LP
	b	l_m_fail
	l	R2, *GL_ALLOC_ADR
	l	R4, *GL_ALLOC_SIZE
	cwi	R4, #GL_HEAP_HDR, LPZ
	b	l_m_fail
	a	R4, R2
l_m_lp:
	c	R2, R4, LPZ
	b	l_m_body
	b	l_m_fail
l_m_body:
	mv	X0, R2
	l	R0, 0(X0)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_m_fail
	mv	R3, R2
	a	R3, R0, EZ
	b	l_m_fail
	c	R4, R3, LPZ
	b	l_m_fail
	mv	X0, R2
	l	R3, 1(X0)
	mv	R3, R3, Z
	b	l_m_next
	c	R0, R1, LPZ
	b	l_m_next
	s	R0, R1
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_m_take
	push	R0
	mv	X0, R2
	st	R1, 0(X0)
	mvwi	R0, #GL_HEAP_USED
	st	R0, 1(X0)
	a	X0, R1
	pop	R0
	st	R0, 0(X0)
	eor	R0, R0
	st	R0, 1(X0)
	b	l_m_user
l_m_take:
	mv	X0, R2
	mvwi	R0, #GL_HEAP_USED
	st	R0, 1(X0)
l_m_user:
	mv	R0, R2
	ai	R0, #GL_HEAP_HDR
	b	l_m_done
l_m_next:
	mv	X0, R2
	l	R0, 0(X0)
	a	R2, R0
	b	l_m_lp
l_m_fail:
	eor	R0, R0
l_m_done:
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; free（malloc で得た先頭を返す。隣接 free は結合する）
; @param R0 - malloc の戻り値（ユーザ先頭）
; @return R0 - 成功時は同じアドレス。失敗は 0
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_free:
	push	R3
	push	R4
	mv	R0, R0, NZ
	b	l_f_fail0
	push	R0
	si	R0, #GL_HEAP_HDR
	l	R2, *GL_ALLOC_ADR
	l	R4, *GL_ALLOC_SIZE
	cwi	R4, #GL_HEAP_HDR, LPZ
	b	l_f_fail1
	a	R4, R2
	mv	R1, R0
l_f_lp:
	c	R2, R4, LPZ
	b	l_f_body
	b	l_f_fail1
l_f_body:
	c	R2, R1, NZ
	b	l_f_hit
	mv	X0, R2
	l	R0, 0(X0)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_f_fail1
	a	R2, R0, ENZ
	b	l_f_advok
	b	l_f_fail1
l_f_advok:
	c	R4, R2, LPZ
	b	l_f_fail1
	b	l_f_lp
l_f_hit:
	mv	X0, R2
	l	R0, 1(X0)
	cwi	R0, #GL_HEAP_USED, Z
	b	l_f_fail1
	eor	R0, R0
	st	R0, 1(X0)
	l	R2, *GL_ALLOC_ADR
	l	R4, *GL_ALLOC_SIZE
	a	R4, R2
l_c_lp:
	c	R2, R4, LPZ
	b	l_c_body
	b	l_f_ok
l_c_body:
	mv	X0, R2
	l	R0, 0(X0)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_f_ok
	l	R1, 1(X0)
	mv	R3, R2
	a	R3, R0, EZ
	b	l_f_ok
	c	R4, R3, LPZ
	b	l_f_ok
	c	R3, R4, NZ
	b	l_f_ok
	mv	R1, R1, Z
	b	l_c_adv
	mv	X0, R3
	l	R1, 1(X0)
	mv	R1, R1, Z
	b	l_c_adv
	l	R1, 0(X0)
	mv	X0, R2
	l	R0, 0(X0)
	a	R0, R1
	st	R0, 0(X0)
	b	l_c_lp
l_c_adv:
	mv	X0, R2
	l	R0, 0(X0)
	a	R2, R0
	b	l_c_lp
l_f_ok:
	pop	R0
	b	l_f_done
l_f_fail1:
	pop	R1
l_f_fail0:
	eor	R0, R0
l_f_done:
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; malloc2 初期化（first-fit・セグメント付きヒープ）
; @param R0 - ヒープ先頭（論理ワードアドレス）
; @param R1 - ヒープ SBR（下位 2bit=0 固定。有効値 0/4/8/C。他はマスク）
; @param R2 - ヒープサイズ（ワード数。2 未満なら確保不可）
; @Destruction なし
; -------------------------------------------------------
g_malloc2_init:
	push	R3
	push	R4
	st	R0, *GL_ALLOC2_ADR
	mv	R3, R2			; R3 = サイズ（第3引数）
	mv	R2, R1
	andi	R2, #0x000c
	st	R2, *GL_ALLOC2_SBR
	st	R3, *GL_ALLOC2_SIZE
	cwi	R3, #GL_HEAP_HDR, LPZ
	b	l_m2i_done
	cpyb	R4, TSR0
	setb	R2, TSR0
	mv	R2, R0
	str	R3, TSR0, (R2)
	eor	R3, R3
	ai	R2, #1
	str	R3, TSR0, (R2)
	setb	R4, TSR0
l_m2i_done:
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; malloc2（ワード単位・first-fit。TSR0 でセグメントアクセス）
; @param R0 - 欲しいワード数（1 以上。ヘッダ 2 ワードは含まない）
; @return R0 - ユーザ領域先頭。失敗は 0
; @return R1 - ユーザ領域の SBR。失敗は 0
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_malloc2:
	push	R3
	push	R4
	cpyb	R3, TSR0
	push	R3
	mv	R1, R0
	mv	R1, R1, NZ
	b	l_m2_fail
	ai	R1, #GL_HEAP_HDR
	c	R1, R0, LP
	b	l_m2_fail
	l	R2, *GL_ALLOC2_ADR
	l	R4, *GL_ALLOC2_SIZE
	cwi	R4, #GL_HEAP_HDR, LPZ
	b	l_m2_fail
	a	R4, R2
	l	R0, *GL_ALLOC2_SBR
	setb	R0, TSR0
l_m2_lp:
	c	R2, R4, LPZ
	b	l_m2_body
	b	l_m2_fail
l_m2_body:
	lr	R0, TSR0, (R2)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_m2_fail
	mv	R3, R2
	a	R3, R0, EZ
	b	l_m2_fail
	c	R4, R3, LPZ
	b	l_m2_fail
	ai	R2, #1
	lr	R3, TSR0, (R2)
	si	R2, #1
	mv	R3, R3, Z
	b	l_m2_next
	c	R0, R1, LPZ
	b	l_m2_next
	s	R0, R1
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_m2_take
	push	R0
	mv	R3, R2
	mv	R0, R1
	str	R0, TSR0, (R2)
	ai	R2, #1
	mvwi	R0, #GL_HEAP_USED
	str	R0, TSR0, (R2)
	mv	R2, R3
	a	R2, R1
	pop	R0
	str	R0, TSR0, (R2)
	ai	R2, #1
	eor	R0, R0
	str	R0, TSR0, (R2)
	mv	R2, R3
	b	l_m2_user
l_m2_take:
	ai	R2, #1
	mvwi	R0, #GL_HEAP_USED
	str	R0, TSR0, (R2)
	si	R2, #1
l_m2_user:
	mv	R0, R2
	ai	R0, #GL_HEAP_HDR
	l	R1, *GL_ALLOC2_SBR
	b	l_m2_done
l_m2_next:
	lr	R0, TSR0, (R2)
	a	R2, R0
	b	l_m2_lp
l_m2_fail:
	eor	R0, R0
	eor	R1, R1
l_m2_done:
	pop	R3
	setb	R3, TSR0
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; free2（malloc2 で得た先頭を返す。隣接 free は結合する）
; @param R0 - malloc2 の戻り値（ユーザ先頭）
; @param R1 - malloc2 の戻り値（SBR）
; @return R0 - 成功時は同じアドレス。失敗は 0
; @return R1 - 成功時は同じ SBR。失敗は 0
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_free2:
	push	R3
	push	R4
	cpyb	R3, TSR0
	push	R3
	mv	R0, R0, NZ
	b	l_f2_fail0
	l	R2, *GL_ALLOC2_SBR
	c	R1, R2, Z
	b	l_f2_fail0
	setb	R2, TSR0
	push	R0
	si	R0, #GL_HEAP_HDR
	l	R2, *GL_ALLOC2_ADR
	l	R4, *GL_ALLOC2_SIZE
	cwi	R4, #GL_HEAP_HDR, LPZ
	b	l_f2_fail1
	a	R4, R2
	mv	R1, R0
l_f2_lp:
	c	R2, R4, LPZ
	b	l_f2_body
	b	l_f2_fail1
l_f2_body:
	c	R2, R1, NZ
	b	l_f2_hit
	lr	R0, TSR0, (R2)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_f2_fail1
	a	R2, R0, ENZ
	b	l_f2_advok
	b	l_f2_fail1
l_f2_advok:
	c	R4, R2, LPZ
	b	l_f2_fail1
	b	l_f2_lp
l_f2_hit:
	ai	R2, #1
	lr	R0, TSR0, (R2)
	si	R2, #1
	cwi	R0, #GL_HEAP_USED, Z
	b	l_f2_fail1
	eor	R0, R0
	ai	R2, #1
	str	R0, TSR0, (R2)
	si	R2, #1
	l	R2, *GL_ALLOC2_ADR
	l	R4, *GL_ALLOC2_SIZE
	a	R4, R2
l_c2_lp:
	c	R2, R4, LPZ
	b	l_c2_body
	b	l_f2_ok
l_c2_body:
	lr	R0, TSR0, (R2)
	cwi	R0, #GL_HEAP_HDR, LPZ
	b	l_f2_ok
	ai	R2, #1
	lr	R1, TSR0, (R2)
	si	R2, #1
	mv	R3, R2
	a	R3, R0, EZ
	b	l_f2_ok
	c	R4, R3, LPZ
	b	l_f2_ok
	c	R3, R4, NZ
	b	l_f2_ok
	mv	R1, R1, Z
	b	l_c2_adv
	ai	R3, #1
	lr	R1, TSR0, (R3)
	si	R3, #1
	mv	R1, R1, Z
	b	l_c2_adv
	lr	R1, TSR0, (R3)
	lr	R0, TSR0, (R2)
	a	R0, R1
	str	R0, TSR0, (R2)
	b	l_c2_lp
l_c2_adv:
	lr	R0, TSR0, (R2)
	a	R2, R0
	b	l_c2_lp
l_f2_ok:
	pop	R0
	l	R1, *GL_ALLOC2_SBR
	b	l_f2_done
l_f2_fail1:
	pop	R3
l_f2_fail0:
	eor	R0, R0
	eor	R1, R1
l_f2_done:
	pop	R3
	setb	R3, TSR0
	pop	R4
	pop	R3
	ret
; -------------------------------------------------------
; CPUレジスタの書き出し
; あらかじめpushmでスタックに積んでおく
; @param R0 - 書き出しエリアアドレス
; @param SP+1 - pushm R4,R3,R2,R1,R0 を積んでおく
; @Destruction R0, R1
; -------------------------------------------------------
g_write_cpu_registers:
	push	R4
	push	R3
	; PSHM 後: SP+1=R4 … SP+5=R0。SP はインデックスに使えない
	mv	X1, R0
	mv 	X0, SP
	l	R0, 4(X0)
	st	R0, HSHK_REG_W_R4(X1)
	l	R0, 5(X0)
	st	R0, HSHK_REG_W_R3(X1)
	l	R0, 6(X0)
	st	R0, HSHK_REG_W_R2(X1)
	l	R0, 7(X0)
	st	R0, HSHK_REG_W_R1(X1)
	l	R0, 8(X0)
	st	R0, HSHK_REG_W_R0(X1)
	; 割り込み直前の SP（PSHM の 5 + 戻りAD + PUSH 2つ ワードを戻した値）
	mv	R0, SP
	ai	R0, #8
	st	R0, HSHK_REG_W_SP(X1)
	; レベル0 OPSW（固定 0000/0001）
	l	R0, *0
	st	R0, HSHK_REG_W_STR(X1)
	l	R0, *1
	st	R0, HSHK_REG_W_IC(X1)
	; CSBR(OSR0)|SSBR（HandShake: H=CSBR L=SSBR。OSR0=割り込み直前の CSBR）
	cpyb	R0, OSR0
	andi	R0, #0x000f
	bswp	R0, R0
	cpyb	R1, SSBR
	andi	R1, #0x000f
	or	R0, R1
	st	R0, HSHK_REG_W_CSBR_SSBR(X1)
	; TSR0|TSR1（H=TSR0 L=TSR1）
	cpyb	R0, TSR0
	andi	R0, #0x000f
	bswp	R0, R0
	cpyb	R1, TSR1
	andi	R1, #0x000f
	or	R0, R1
	st	R0, HSHK_REG_W_TSR0_1(X1)
	; NPP を値H（上位 8bit）へ。線上は 1 バイト、下位は未使用
	cpys	R0, NPP
	andi	R0, #0x00ff
	bswp	R0, R0
	st	R0, HSHK_REG_W_NPP(X1)
	pop	R3
	pop	R4
	ret

	.area	_SYS_PAGE0		(REL,NOLOAD)
; 乱数種
GL_RND_SEED:	.ds	1

; BAL 間接ディスパッチ用（handshake IRQ）
GL_BAL_TMP:	.ds	1

; ヒープアドレス
GL_ALLOC_ADR:	.ds	1
; ヒープサイズ
GL_ALLOC_SIZE:	.ds	1

; ヒープアドレス2
GL_ALLOC2_ADR:	.ds	1
; ヒープBR
GL_ALLOC2_SBR:	.ds	1
; ヒープサイズ
GL_ALLOC2_SIZE:	.ds	1
