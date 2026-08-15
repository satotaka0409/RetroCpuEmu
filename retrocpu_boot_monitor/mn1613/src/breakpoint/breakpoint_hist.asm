; breakpoint_hist.asm
; 比較器ヒット時の履歴追記（Bit7、3F000h / SBR C）
; 根拠: HandShake.mdc 17h エントリ / breakpoint.mdc / boot_monitor.mdc
;
; g_breakpoint_interrupt_handler が比較一致のあと BALD する。
; 11h で時刻を取り、リング 16 件へ 33 ワードを書く。失敗しても時刻 0 で書く。
; ステップ実行はここへ来ない。

	.cpu	mn1613

	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bp_hist_append
	.global g_hshk_mem_map
	.global g_hshk_get_time
	.global GL_BP_HIT_PREV
	.global GL_BP_SNAP_R3
	.global GL_BP_SNAP_TSR0
	.global GL_BP_SNAP_SP
	.global GL_BP_HIST_META

BP_KIND_IO		.equ	2

; -------------------------------------------------------
; Bit7 履歴 1 件を 3F000h へ追記（17h エントリ）。
; @note 入口: R2=区分、R3=スロット、X1=10h 表。比較一致済み。
; @note 11h の応答待ち前に BUSY を下ろす。
; @Destruction R0, R1（R2 / R3 / X1 は保存）
; -------------------------------------------------------
g_bp_hist_append:
	push	R2
	push	R3
	push	X1

	; AFTER: MEM/命令は監視アドレスの現在値。IO は 0
	cwi	R2, #BP_KIND_IO, Z
	b	l_bp_ha_mem
	b	l_bp_ha_io
l_bp_ha_mem:
	l	R0, 3(X1)
	l	R1, 4(X1)
	bald	g_hshk_mem_map
	lr	R0, TSR0, (R1)
	b	l_bp_ha_after
l_bp_ha_io:
	eor	R0, R0
l_bp_ha_after:
	mvwi	X0, #GL_BP_HIT_DATA
	st	R0, 0(X0)

	; PREV: 命令、または WR でない → 0000h。WR なら 0034 生値
	mv	X0, SP
	l	X1, 1(X0)		; 表（X0≡R3 になる）
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_INST, NZ
	b	l_bp_ha_prev_wr
	eor	R1, R1
	b	l_bp_ha_prev_st
l_bp_ha_prev_wr:
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_WR, NZ
	b	l_bp_ha_prev_z
	mvwi	X0, #GL_BP_HIT_PREV
	l	R1, 0(X0)
	b	l_bp_ha_prev_st
l_bp_ha_prev_z:
	eor	R1, R1
l_bp_ha_prev_st:
	mvwi	X0, #GL_BP_HIT_PREV_W
	st	R1, 0(X0)

	; 11h。INT2 中は BUSY=1 のままでは IO が応答しない
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	si	SP, #4
	mv	X0, SP
	eor	R0, R0
	st	R0, 1(X0)
	st	R0, 2(X0)
	st	R0, 3(X0)
	st	R0, 4(X0)
	bald	g_hshk_get_time

	; スロット → メタ。dest = F000h + slot*528 + head*33
	; *33 = <<5 + n、*528 = <<9 + <<4
	mv	X0, SP
	l	R3, 6(X0)		; スロット（時刻 4 + 表の下）
	mv	R0, R3
	sl	R0, RE
	a	R0, R3			; *3
	mvwi	R1, #GL_BP_HIST_META
	a	R0, R1
	mvwi	X1, #GL_BP_HIST_MPTR
	st	R0, 0(X1)
	mv	X1, R0			; メタ
	l	R0, 1(X1)		; head
	mv	R1, R0
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	a	R1, R0			; head*33
	mv	R2, R1
	mv	R0, R3			; slot
	mv	R1, R0
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; *16
	mv	R0, R1
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; *512
	a	R1, R0			; slot*528
	a	R1, R2			; + head*33
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0			; 論理 dest
	mv	X1, R1
	eor	R0, R0
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0

	; 時刻 4 ワード
	mv	X0, SP
	ai	X0, #1
	mvi	R2, #4
l_bp_ha_ct:
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X0, #1
	ai	X1, #1
	si	R2, #1, Z
	b	l_bp_ha_ct
	mvwi	X0, #GL_BP_HIT_DATA
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, 1(X0)		; GL_BP_HIT_PREV_W（隣接）
	str	R0, TSR0, (R4)
	ai	X1, #1

	; レジスタ 11 ワード（R0–R2 は 0。R3/R4 は入口スナップ）
	eor	R0, R0
	str	R0, TSR0, (R4)
	ai	X1, #1
	str	R0, TSR0, (R4)
	ai	X1, #1
	str	R0, TSR0, (R4)
	ai	X1, #1
	mvwi	X0, #GL_BP_SNAP_R3
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, 1(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	mvwi	X0, #GL_BP_SNAP_SP
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *HSHK_L2_STR_SAVE
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *HSHK_L2_IC_SAVE
	str	R0, TSR0, (R4)
	ai	X1, #1
	cpyb	R0, OSR0
	andi	R0, #0x000f
	bswp	R0, R0
	cpyb	R1, SSBR
	andi	R1, #0x000f
	or	R0, R1
	str	R0, TSR0, (R4)
	ai	X1, #1
	mvwi	X0, #GL_BP_SNAP_TSR0
	l	R0, 0(X0)
	bswp	R0, R0
	l	R1, 1(X0)
	or	R0, R1
	str	R0, TSR0, (R4)
	ai	X1, #1
	cpys	R0, NPP
	andi	R0, #0x00ff
	bswp	R0, R0
	str	R0, TSR0, (R4)

	; スタック 16 ワード（SNAP_SP=0 なら 0 埋め）
	mvwi	X0, #GL_BP_SNAP_SP
	l	R2, 0(X0)
	or	R2, R2, Z
	b	l_bp_ha_stk
	mvi	R2, #HSHK_BH_STACK_WORDS
	eor	R0, R0
l_bp_ha_stk_z:
	ai	X1, #1
	str	R0, TSR0, (R4)
	si	R2, #1, Z
	b	l_bp_ha_stk_z
	b	l_bp_ha_meta
l_bp_ha_stk:
	mv	X0, R2
	mvi	R2, #HSHK_BH_STACK_WORDS
l_bp_ha_stk_lp:
	ai	X0, #1
	l	R0, 0(X0)
	ai	X1, #1
	str	R0, TSR0, (R4)
	si	R2, #1, Z
	b	l_bp_ha_stk_lp
l_bp_ha_meta:
	mvwi	X0, #GL_BP_HIST_MPTR
	l	X1, 0(X0)
	l	R0, 1(X1)
	ai	R0, #1
	andi	R0, #0x000f
	st	R0, 1(X1)
	l	R0, 0(X1)
	cwi	R0, #HSHK_BH_DEPTH, M
	b	l_bp_ha_full
	ai	R0, #1
	st	R0, 0(X1)
	b	l_bp_ha_meta_ok
l_bp_ha_full:
	mvi	R0, #1
	st	R0, 2(X1)
l_bp_ha_meta_ok:
	ai	SP, #4
	mvwi	X0, #GL_BP_SNAP_TSR0
	l	R0, 0(X0)
	setb	R0, TSR0
	pop	X1
	pop	R3
	pop	R2
	ret

	.area	_WORK		(REL,NOLOAD)
; 履歴に書く AFTER / フィルタ後 PREV
GL_BP_HIT_DATA:		.ds	1
GL_BP_HIT_PREV_W:	.ds	1
; 追記中のメタ先頭
GL_BP_HIST_MPTR:	.ds	1
; スロット 0–7: 件数 / 次書込 index / オーバフロー
GL_BP_HIST_META:	.ds	HSHK_BH_META_TBL
