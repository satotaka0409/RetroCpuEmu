; handshake_break_hist.asm
; ブレイク履歴取得（ハンドシェイク 17h、IO→CPU）
; 根拠: HandShake.mdc「ブレイク履歴取得」/ boot_monitor.mdc / breakpoint.mdc
;
; コマンド 1B は IRQ ディスパッチ済み。残り 1B: slot（0–3）。
; CPU→IO: 件数, flags, n_stop, pad0, addr32 BE, histCount, pad0（計 10B）
;   ＋ エントリ×件数×66B（番号順 index 0 から）＋ 終端 1B（00h OK / 01h NG / 02h 履歴未設定）。
; エントリ 66B: 時刻4語 + AFTER + PREV + レジスタ 10語 + NPP 1B + パディング 0 + スタック 16 語。
; スロット 0–3。番号不正はヘッダ 0 のあと 01h。Bit7 なしは件数 0・02h。
; OVF はメタのみ（線上ヘッダにステータスバイトは無い）。
; 履歴本体は 3F000h（SBR C + 論理 F000h）。線上送信は CSBR=0 のフレーム複写経由。
; 局所 bald は SP+1 が戻り。X0≡R3 なので、スロットは R1 から直接フレームへ書く。
; g_* / 局所ヘルパは BALD / RET。R3–R4・TSR0 は退避。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_break_hist_get
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global GL_HSHK_ADDR_BREAK
	.global GL_BP_HIST_META

; スタック（callee、PUSH R3/R4 のあと）。メインから見たオフセット。
; +1 TSR0 / +2 スロット / +3 件数 / +4 終端 / +5.. エントリ複写 33 語
HSHK_BH_TSR0		.equ	1
HSHK_BH_SLOT		.equ	2
HSHK_BH_N		.equ	3
HSHK_BH_END		.equ	4
HSHK_BH_WIRE		.equ	5
HSHK_BH_FR		.equ	HSHK_BH_END+HSHK_BH_ENTRY_WORDS
; AI/SI 即値は 4bit（1–15）なので確保・解放は 15+15+7
HSHK_BH_FR_A		.equ	15
HSHK_BH_FR_B		.equ	15
HSHK_BH_FR_C		.equ	7
; l_bh_send_ents: bald のあと push R3/R4・件数・index。スロットは呼び出し元フレーム +7
HSHK_BH_SE_SLOT		.equ	7
; ループ中の複写先頭（WIRE + index/件数/R4/R3/戻り の 5 語）
HSHK_BH_SE_WIRE		.equ	HSHK_BH_WIRE+5
; 1 エントリ 33 語のうち、線上は先行 16 語を 16bit BE、NPP+パディング、スタック 16 語
HSHK_BH_SEND_WORDS	.equ	16

; -------------------------------------------------------
; ブレイク履歴取得（17h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み。IRQ コンテキスト（IO→CPU 転送中）。
; @note 線上 受信 1B（slot）→ 送信 10B ヘッダ＋エントリ×66B＋終端 1B
; @return R0 - 終端ステータス（HSHK_OK / HSHK_NG / HSHK_NG_OTHER=履歴未設定）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_break_hist_get:
	push	R3
	push	R4
	si	SP, #HSHK_BH_FR_A
	si	SP, #HSHK_BH_FR_B
	si	SP, #HSHK_BH_FR_C
	cpyb	R0, TSR0
	andi	R0, #0x000f
	mv	X0, SP
	st	R0, HSHK_BH_TSR0(X0)
	eor	R0, R0
	st	R0, HSHK_BH_SLOT(X0)
	st	R0, HSHK_BH_N(X0)
	mvi	R0, #HSHK_NG
	st	R0, HSHK_BH_END(X0)
	; 履歴リングは SBR C。表・メタ・複写先（スタック）は CSBR=0 のまま読む
	eor	R0, R0
	setb	R0, TSR0

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_bh_fail
	andi	R1, #0x00ff
	mv	X0, SP
	st	R1, HSHK_BH_SLOT(X0)	; X0≡R3 なので R1 から書く
	l	R3, HSHK_BH_SLOT(X0)

	cwi	R3, #HSHK_AB_SLOTS, M
	b	l_bh_bad
	b	l_bh_user
l_bh_bad:
	; 番号不正: 設定は触らず、件数 0・flags/addr 0・終端 NG
	eor	R4, R4
	eor	R0, R0
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

; --- ユーザ 0–3 ---
l_bh_user:
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
	; Bit7 なし: 件数 0・終端 02h。flags/addr は表のエコー（ステータスバイト無し）
	eor	R0, R0
	mvi	R2, #HSHK_NG_OTHER
	mv	X0, SP
	st	R0, HSHK_BH_N(X0)
	st	R2, HSHK_BH_END(X0)
	mv	R4, X1
	bald	l_bh_send_hdr
	b	l_bh_fin
l_bh_hist:
	push	X1			; 10h 表（メタ走査で X1 を潰す）
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
	pop	X1			; 10h 表
	mvi	R2, #HSHK_OK
	mv	X0, SP
	st	R0, HSHK_BH_N(X0)
	st	R2, HSHK_BH_END(X0)
	mv	R4, X1
	bald	l_bh_send_hdr
	cwi	R0, #HSHK_OK, Z
	b	l_bh_fin
	mv	X0, SP
	l	R0, HSHK_BH_N(X0)
	or	R0, R0, Z
	b	l_bh_do_ents
	b	l_bh_fin
l_bh_do_ents:
	bald	l_bh_send_ents
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
	ai	SP, #HSHK_BH_FR_A
	ai	SP, #HSHK_BH_FR_B
	ai	SP, #HSHK_BH_FR_C
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; ヘッダ 10B を CPU→IO で送る
; @note count, flags, n_stop, pad0, addr32 BE, histCount(=count), pad0
; @note 件数と終端ステータスは呼び出し側がフレームへ書く。ここは線上送信のみ。
; @note R4=0 なら flags/count/addr は 0（番号不正）。非 0 なら 10h 表ポインタ。
; @param R0 - 有効件数（0–4、下位 8bit）。histCount にも同じ値を送る
; @param R4 - 10h スロット表先頭。0 ならエコー欄を 0 埋め
; @return R0 - 最後の send の OK / NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_bh_send_hdr:
	push	R0			; histCount 用に件数を保存
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	or	R4, R4, NZ
	b	l_bh_hdr_zero
	b	l_bh_hdr_tbl
l_bh_hdr_zero:
	eor	R0, R0
	bald	g_hshk_send_byte	; flags
	eor	R0, R0
	bald	g_hshk_send_byte	; n_stop
	eor	R0, R0
	bald	g_hshk_send_byte	; pad
	eor	R0, R0
	bald	g_hshk_send_word	; addr_hi
	eor	R0, R0
	bald	g_hshk_send_word	; addr_lo
	b	l_bh_hdr_tail
l_bh_hdr_tbl:
	; R4≠0 のとき X1≡R4 が 10h 表（番号不正時は R4=0 で zero 経路）
	l	R0, HSHK_AB_W_FLAGS(X1)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	l	R0, HSHK_AB_W_COUNT(X1)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_byte	; pad
	l	R0, HSHK_AB_W_ADDR_HI(X1)
	bald	g_hshk_send_word
	l	R0, HSHK_AB_W_ADDR_LO(X1)
	bald	g_hshk_send_word
l_bh_hdr_tail:
	pop	R0			; histCount = 件数
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_byte	; pad
	ret

; -------------------------------------------------------
; 履歴エントリを番号順（index 0 から）に送る
; @note スロットは呼び出し元フレーム HSHK_BH_SLOT。SBR C からフレーム複写（HSHK_BH_WIRE）へ写して送る。
; @note 1 件 66B = 16 語 BE + NPP 1B + パディング 0 + スタック 16 語。
; @param R0 - 送信件数（0 なら何もしない。1–4）
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
	eor	R1, R1			; index 0 から
	push	R1
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
l_bh_se_lp:
	; この時点のスタック: +1 index / +2 残り件数 / +3 R4 / +4 R3 / +5 戻り
	; / +6 TSR0 / +7 スロット / … / +10 複写先頭
	; エントリ先頭 = F000h + slot*132 + index*33
	; *33 = <<5 + n、*132 = <<7 + <<2
	mv	X1, SP
	l	R0, 1(X1)		; index
	mv	R1, R0
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	a	R1, R0			; index*33
	mv	R2, R1
	mv	X1, SP
	l	R0, HSHK_BH_SE_SLOT(X1)	; slot
	mv	R1, R0
	sl	R1, RE
	sl	R1, RE			; *4
	mv	R0, R1
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; *128
	a	R1, R0			; slot*132
	a	R1, R2			; + index*33
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0			; 元論理（TSR0=SBR C）
	eor	R0, R0
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
	mv	X1, SP
	ai	X1, #HSHK_BH_SE_WIRE
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
	mv	X1, SP
	ai	X1, #HSHK_BH_SE_WIRE
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
	; 末尾語の上位 8bit が NPP。パディング 1B のあとスタック 16 語
	l	R0, 0(X1)
	bswp	R0, R0
	andi	R0, #0x00ff
	push	X1
	bald	g_hshk_send_byte
	eor	R0, R0
	bald	g_hshk_send_byte
	pop	X1
	ai	X1, #1
	mvwi	R2, #HSHK_BH_STACK_WORDS
l_bh_se_stk:
	l	R0, 0(X1)
	ai	X1, #1
	push	R2
	push	X1
	bald	g_hshk_send_word
	pop	X1
	pop	R2
	si	R2, #1, Z
	b	l_bh_se_stk
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0
	mv	X1, SP
	l	R1, 1(X1)
	ai	R1, #1
	andi	R1, #HSHK_BH_INDEX_MASK
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
