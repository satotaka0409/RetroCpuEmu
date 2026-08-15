; handshake_break_hist.asm
; ブレイク履歴取得（ハンドシェイク 60h、IO→CPU）
; 根拠: HandShake.mdc「ブレイク履歴取得」/ boot_monitor.mdc / breakpoint.mdc
;
; コマンド 1B は IRQ ディスパッチ済み。残り 2B: slot, フラグ（Bit0=取得後クリア）。
; CPU→IO: 件数, ステータス, flags, count, addr32 BE（計 8B）
;   ＋ エントリ×件数×34B（新しい順）＋ 終端 1B（00h OK / 01h NG / 02h 履歴未設定）。
; エントリ 34B: 時刻4語 + AFTER + PREV + 48h レジスタ 10語 + NPP 1B + パディング 0。
; スロット 0–7。番号不正はヘッダ 0 のあと 01h。Bit7 なしは件数 0・02h。
; 履歴本体は 3F000h（SBR C + 論理 F000h）。線上送信は CSBR=0 の GL_BH_WIRE 経由。
; 局所 bald は SP+1 が戻り。フレームは push したあと ai X0,#1 してから触る。
; g_* / 局所ヘルパは BALD / RET。R3–R4・TSR0 は退避。X0≡R3 なのでスロットは GL_BH_SLOT。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_break_hist_get
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global GL_HSHK_ADDR_BREAK
	.global GL_BP_HIST_META

; スタック（callee、PUSH R3/R4 のあと si #4）。メインから見たオフセット。
; +1 入口 TSR0 / +2 取得後クリア / +3 件数 / +4 終端ステータス
HSHK_BH_FR		.equ	4
HSHK_BH_TSR0		.equ	1
HSHK_BH_CLRFLG		.equ	2
HSHK_BH_N		.equ	3
HSHK_BH_END		.equ	4
; 1 エントリ 17 語のうち、線上は先行 16 語を 16bit BE、末尾 1 語を NPP+パディング
HSHK_BH_SEND_WORDS	.equ	16

; -------------------------------------------------------
; ブレイク履歴取得（60h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み。IRQ コンテキスト（IO→CPU 転送中）。
; @note 線上 受信 2B（slot, flags）→ 送信 8B ヘッダ＋エントリ×34B＋終端 1B
; @return R0 - 終端ステータス（HSHK_OK / HSHK_NG / HSHK_NG_OTHER=履歴未設定）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_break_hist_get:
	push	R3
	push	R4
	si	SP, #HSHK_BH_FR
	cpyb	R0, TSR0
	andi	R0, #0x000f
	mv	X0, SP
	st	R0, HSHK_BH_TSR0(X0)
	eor	R0, R0
	st	R0, HSHK_BH_CLRFLG(X0)
	st	R0, HSHK_BH_N(X0)
	mvi	R0, #HSHK_NG
	st	R0, HSHK_BH_END(X0)
	; 履歴リングは SBR C。表・メタ・GL_BH_* は CSBR=0 のまま読む
	eor	R0, R0
	setb	R0, TSR0

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bh_fail
	andi	R1, #0x00ff
	mv	R3, R1			; スロット。以降 X0 を使うときは GL_BH_SLOT へ退避

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bh_fail
	andi	R1, #HSHK_BH_CLR
	mv	R2, R1
	; X0≡R3 なのでスロットを積んでからフレームへ書く
	push	R3
	mv	X0, SP
	ai	X0, #1
	st	R2, HSHK_BH_CLRFLG(X0)
	pop	R3

	cwi	R3, #HSHK_AB_SLOTS, M
	b	l_bh_bad
	b	l_bh_user
l_bh_bad:
	; 番号不正: 設定は触らず、件数 0・flags/addr 0・終端 NG
	eor	R4, R4
	eor	R0, R0
	eor	R1, R1
	mvi	R2, #HSHK_NG
	mv	X0, SP
	st	R0, HSHK_BH_N(X0)
	st	R2, HSHK_BH_END(X0)
	bald	l_bh_send_hdr
	b	l_bh_fin
l_bh_fail:
	; 受信失敗時はヘッダを出さず終端 NG のみ
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_bh_done

; --- ユーザ 0–7 ---
l_bh_user:
	st	R3, GL_BH_SLOT
	; X1 = GL_HSHK_ADDR_BREAK + slot*6（1 スロット 6 語）
	mv	R0, R3
	sl	R0, RE
	mv	R2, R0
	sl	R0, RE
	a	R2, R0
	mvwi	X1, #GL_HSHK_ADDR_BREAK
	a	X1, R2

	l	R0, HSHK_AB_W_FLAGS(X1)
	andi	R0, #HSHK_AB_F_HIST, NZ
	b	l_bh_nohist
	b	l_bh_hist
l_bh_nohist:
	; Bit7 なし: 件数 0・ステータス Bit1・終端 02h。flags/addr は表のエコー
	eor	R0, R0
	mvi	R1, #HSHK_BH_ST_NOHIST
	mvi	R2, #HSHK_NG_OTHER
	push	R3
	mv	X0, SP
	ai	X0, #1
	st	R0, HSHK_BH_N(X0)
	st	R2, HSHK_BH_END(X0)
	pop	R3
	bald	l_bh_send_hdr
	b	l_bh_fin
l_bh_hist:
	push	X1			; 40h 表（メタ走査で X1 を潰す）
	; メタ = GL_BP_HIST_META + slot*3
	mv	R0, R3
	sl	R0, RE
	a	R0, R3
	mvwi	X1, #GL_BP_HIST_META
	a	X1, R0
	l	R0, HSHK_BH_MW_COUNT(X1)
	andi	R0, #0x00ff
	cwi	R0, #HSHK_BH_DEPTH, M
	b	l_bh_n_clamp
	b	l_bh_n_ok
l_bh_n_clamp:
	mvi	R0, #HSHK_BH_DEPTH
l_bh_n_ok:
	l	R2, HSHK_BH_MW_OVF(X1)
	andi	R2, #HSHK_BH_ST_OVF
	pop	X1			; 40h 表
	mv	R1, R2			; 線上ステータス（Bit0=OVF）
	mvi	R2, #HSHK_OK
	push	R3
	mv	X0, SP
	ai	X0, #1
	st	R0, HSHK_BH_N(X0)
	st	R2, HSHK_BH_END(X0)
	pop	R3
	bald	l_bh_send_hdr
	cwi	R0, #HSHK_OK, Z
	b	l_bh_fin
	mv	X0, SP
	l	R0, HSHK_BH_N(X0)
	or	R0, R0, Z
	b	l_bh_do_ents
	b	l_bh_after_ents
l_bh_do_ents:
	bald	l_bh_send_ents
l_bh_after_ents:
	mv	X0, SP
	l	R0, HSHK_BH_CLRFLG(X0)
	or	R0, R0, Z
	b	l_bh_do_clr
	b	l_bh_fin
l_bh_do_clr:
	bald	l_bh_clear
	b	l_bh_fin

l_bh_fin:
	mv	X0, SP
	l	R1, HSHK_BH_TSR0(X0)
	setb	R1, TSR0
	l	R0, HSHK_BH_END(X0)
	push	R0
	bald	g_hshk_send_byte
	pop	R0
	b	l_bh_epilogue
l_bh_done:
	mvwi	R0, #HSHK_NG
	mv	X0, SP
	l	R1, HSHK_BH_TSR0(X0)
	setb	R1, TSR0
l_bh_epilogue:
	ai	SP, #HSHK_BH_FR
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; ヘッダ 8B を CPU→IO で送る（件数, ステータス, flags, count, addr32 BE）
; @note 件数と終端ステータスは呼び出し側がフレームへ書く。ここは線上送信のみ。
; @note R4=0 なら flags/count/addr は 0（番号不正）。非 0 なら 40h 表ポインタ。
; @param R0 - 有効件数（0–16、下位 8bit）
; @param R1 - ステータス（Bit0=OVF / Bit1=履歴未設定）
; @param R4 - 40h スロット表先頭。0 ならエコー欄を 0 埋め
; @return R0 - 最後の send の OK / NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_bh_send_hdr:
	push	R1
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	pop	R0
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	or	R4, R4, NZ
	b	l_bh_hdr_zero
	b	l_bh_hdr_tbl
l_bh_hdr_zero:
	eor	R0, R0
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_word
	eor	R0, R0
	bald	g_hshk_send_word
	ret
l_bh_hdr_tbl:
	l	R0, HSHK_AB_W_FLAGS(X1)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	l	R0, HSHK_AB_W_COUNT(X1)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	l	R0, HSHK_AB_W_ADDR_HI(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_AB_W_ADDR_LO(X1)
	bald	g_hshk_send_word
	ret

; -------------------------------------------------------
; 履歴エントリを新しい順に送る
; @note スロットは GL_BH_SLOT（X0≡R3 のため引数にしない）。SBR C から GL_BH_WIRE へ写して送る。
; @note リング最新は (NEXT-1) & 15。1 件 34B = 16 語 BE + NPP 1B + パディング 0。
; @param R0 - 送信件数（0 なら何もしない。1–16）
; @return R0 - 最後の send の OK / NG（件数 0 なら入口のまま）
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_bh_send_ents:
	push	R3
	push	R4
	or	R0, R0, Z
	b	l_bh_se_go
	b	l_bh_se_done
l_bh_se_go:
	push	R0			; 残り件数
	mvwi	X1, #GL_BH_SLOT
	l	R3, 0(X1)
	mv	R0, R3
	sl	R0, RE
	a	R0, R3			; slot*3
	mvwi	X1, #GL_BP_HIST_META
	a	X1, R0
	l	R1, HSHK_BH_MW_NEXT(X1)
	si	R1, #1
	andi	R1, #0x000f		; 最新 index
	push	R1
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
l_bh_se_lp:
	; この時点のスタック: +1 index / +2 残り件数 / +3 退避 R4 / +4 退避スロット
	; エントリ先頭 = F000h + slot*272 + index*17（M は R0×(Ri)→DR0、下位は R1）
	mv	X1, SP
	l	R0, 1(X1)		; index
	mvwi	R2, #GL_BH_K17
	m	DR0, (R2)		; index*17
	mv	R2, R1
	mvwi	X1, #GL_BH_SLOT
	l	R0, 0(X1)		; slot
	mvwi	X1, #GL_BH_K272
	m	DR0, (R4)		; slot*272（X1≡R4）
	a	R1, R2			; + index*17
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0			; 元論理（TSR0=SBR C）
	eor	R0, R0
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
	mvwi	X1, #GL_BH_WIRE
	eor	R2, R2
	mvi	R2, #HSHK_BH_ENTRY_WORDS
l_bh_se_cp:
	lr	R0, TSR0, (R1)
	ai	R1, #1
	st	R0, 0(X1)
	ai	X1, #1
	si	R2, #1, Z
	b	l_bh_se_cp
	; 線上は CSBR=0。先行 16 語をワード送信
	mvwi	X1, #GL_BH_WIRE
	mvwi	R2, #HSHK_BH_SEND_WORDS
l_bh_se_w:
	l	R0, 0(X1)
	ai	X1, #1
	push	R2
	push	X1
	bald	g_hshk_send_word
	pop	X1
	pop	R2
	si	R2, #1, Z
	b	l_bh_se_w
	; 末尾語の上位 8bit が NPP。パディング 1B でエントリ 34B
	l	R0, 0(X1)
	bswp	R0, R0
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_byte
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
	mv	X1, SP
	l	R1, 1(X1)
	si	R1, #1
	andi	R1, #0x000f
	st	R1, 1(X1)
	l	R0, 2(X1)
	si	R0, #1
	st	R0, 2(X1)
	or	R0, R0, Z
	b	l_bh_se_lp
	ai	SP, #2			; index + 残り件数
l_bh_se_done:
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 当該スロットの履歴メタとリングを 0 にする
; @note スロットは GL_BH_SLOT。Bit0=1（取得後クリア）のときだけ呼ぶ。
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_bh_clear:
	push	R3
	push	R4
	mvwi	X1, #GL_BH_SLOT
	l	R3, 0(X1)
	mv	R0, R3
	sl	R0, RE
	a	R0, R3			; slot*3
	mvwi	X1, #GL_BP_HIST_META
	a	X1, R0
	eor	R0, R0
	st	R0, HSHK_BH_MW_COUNT(X1)
	st	R0, HSHK_BH_MW_NEXT(X1)
	st	R0, HSHK_BH_MW_OVF(X1)
	; リング先頭 = F000h + slot*272
	mv	R1, R3
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	mv	R2, R1
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	a	R1, R2
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0
	mv	X1, R1
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
	mvwi	R2, #HSHK_BH_SLOT_WORDS
	eor	R0, R0
l_bh_cl_lp:
	str	R0, TSR0, (R4)
	ai	X1, #1
	si	R2, #1, Z
	b	l_bh_cl_lp
	pop	R4
	pop	R3
	ret

	.area	_DATA		(REL,CON)
; M 命令用（レジスタ間接のみ。CSBR=0 の ROM）
GL_BH_K17:		.dw	HSHK_BH_ENTRY_WORDS
GL_BH_K272:		.dw	HSHK_BH_SLOT_WORDS

	.area	_WORK		(REL,NOLOAD)
; 60h: 対象スロット（X0≡R3 なのでフレーム経由にしない）
GL_BH_SLOT:		.ds	1
; 60h: SBR C の 1 エントリを CSBR=0 へ写してから送る
GL_BH_WIRE:		.ds	HSHK_BH_ENTRY_WORDS
