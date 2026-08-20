; breakpoint_hist.asm
; 比較器ヒット時の履歴追記（Bit7、3F000h / SBR C）
; 根拠: HandShake.mdc 17h エントリ / breakpoint.mdc / boot_monitor.mdc
;
; g_breakpoint_interrupt_handler が比較一致のあと BALD する。
; 11h で時刻を取り、リング 16 件へ 33 ワードを書く。失敗しても時刻 0 で書く。
; ステップ実行はここへ来ない。作業域はスタックのみ（GL_BP_HIST_META を除く）。

	.cpu	mn1613

	.include "../interrupt_io.inc"
	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	; @unwarning
	.global g_bp_hist_append
	.global g_hshk_mem_map
	.global g_hshk_get_time_
	.global GL_BP_HIST_META

BP_KIND_IO		.equ	2

; 4 PUSH（kind/slot/表/snap）のあと si #7。X0=SP
; +1..+4 時刻、+5 AFTER、+6 PREV（フィルタ後）、+7 メタ先頭
BP_HA_SCR		.equ	7
BP_HA_T0		.equ	1
BP_HA_AFTER		.equ	5
BP_HA_PREVW		.equ	6
BP_HA_MPTR		.equ	7
BP_HA_SNAP		.equ	8
BP_HA_TBL		.equ	9
BP_HA_SLOT		.equ	10
BP_HA_KIND		.equ	11

; -------------------------------------------------------
; Bit7 履歴 1 件を 3F000h へ追記（17h エントリ）。
; @note 入口: R0=スナップ先頭（HSHK_BP_SNAP_*）、R2=区分、R3=スロット、X1=10h 表。比較一致済み。
; @note 11h の応答待ち前に BUSY を下ろす。作業変数はスタック。
; @param R0 - 入口スナップ（6 ワード。0034 / R3 / R4 / TSR0 / TSR1 / ユーザ SP）
; @param R2 - 1Ah 区分（0=命令 / 1=MEM / 2=IO）
; @param R3 - スロット 0–7
; @param R4 - 10h 表ポインタ（X1）
; @Destruction R0, R1
; -------------------------------------------------------
g_bp_hist_append:
	push	R2
	push	R3
	push	X1
	push	R0
	si	SP, #BP_HA_SCR
	mv	X0, SP
	eor	R0, R0
	st	R0, BP_HA_AFTER(X0)
	st	R0, BP_HA_PREVW(X0)
	st	R0, BP_HA_T0(X0)
	st	R0, 2(X0)
	st	R0, 3(X0)
	st	R0, 4(X0)

	; AFTER: MEM/命令は監視アドレスの現在値。IO は 0
	l	R2, BP_HA_KIND(X0)
	cwi	R2, #BP_KIND_IO, Z
	b	l_bp_ha_mem
	b	l_bp_ha_prev
l_bp_ha_mem:
	l	X1, BP_HA_TBL(X0)
	l	R0, 3(X1)
	l	R1, 4(X1)
	bald	g_hshk_mem_map
	lr	R0, TSR0, (R1)
	mv	X0, SP
	st	R0, BP_HA_AFTER(X0)
l_bp_ha_prev:
	; PREV: 命令、または WR でない → 0000h。WR ならスナップの 0034
	mv	X0, SP
	l	X1, BP_HA_TBL(X0)
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_INST, NZ
	b	l_bp_ha_prev_wr
	b	l_bp_ha_prev_done
l_bp_ha_prev_wr:
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_WR, NZ
	b	l_bp_ha_prev_z
	l	X1, BP_HA_SNAP(X0)
	l	R1, HSHK_BP_SNAP_PREV(X1)
	st	R1, BP_HA_PREVW(X0)
	b	l_bp_ha_prev_done
l_bp_ha_prev_z:
	eor	R0, R0
	st	R0, BP_HA_PREVW(X0)
l_bp_ha_prev_done:
	; 11h。INT2 中は BUSY=1 のままでは IO が応答しない
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	bald	g_hshk_get_time_

	; スロット → メタ。dest = F000h + slot*528 + head*33
	; *33 = <<5 + n、*528 = <<9 + <<4
	; X0≡R3 なので、スロットは R2 に置き、MPTR を書いてから X0 を捨てる
	mv	X0, SP
	l	R2, BP_HA_SLOT(X0)
	mv	R0, R2
	sl	R0, RE
	a	R0, R2			; *3
	mvwi	R1, #GL_BP_HIST_META
	a	R0, R1
	st	R0, BP_HA_MPTR(X0)
	mv	X1, R0			; メタ
	l	R0, 1(X1)		; head
	mv	R1, R0
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	a	R1, R0			; head*33
	mv	R0, R1
	mv	R1, R2			; slot
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; *16
	mv	R2, R1
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; *512
	a	R1, R2			; slot*528
	a	R1, R0			; + head*33
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0			; 論理 dest
	mv	X1, R1
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0

	; 時刻 4 ワード
	mv	X0, SP
	ai	X0, #BP_HA_T0
	mvwi	R2, #4
l_bp_ha_ct:
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X0, #1
	ai	X1, #1
	si	R2, #1, Z
	b	l_bp_ha_ct
	mv	X0, SP
	l	R0, BP_HA_AFTER(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, BP_HA_PREVW(X0)
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
	mv	X0, SP
	l	X0, BP_HA_SNAP(X0)
	l	R0, HSHK_BP_SNAP_R3(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, HSHK_BP_SNAP_R4(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, HSHK_BP_SNAP_SP(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *INT1_STR_SAVE
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *INT1_IC_SAVE
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
	l	R0, HSHK_BP_SNAP_TSR0(X0)
	bswp	R0, R0
	l	R1, HSHK_BP_SNAP_TSR1(X0)
	or	R0, R1
	str	R0, TSR0, (R4)
	ai	X1, #1
	cpys	R0, NPP
	andi	R0, #0x00ff
	bswp	R0, R0
	str	R0, TSR0, (R4)

	; スタック 16 ワード（SNAP_SP=0 なら 0 埋め）
	l	R2, HSHK_BP_SNAP_SP(X0)
	or	R2, R2, Z
	b	l_bp_ha_stk
	mvwi	R2, #HSHK_BH_STACK_WORDS
	eor	R0, R0
l_bp_ha_stk_z:
	ai	X1, #1
	str	R0, TSR0, (R4)
	si	R2, #1, Z
	b	l_bp_ha_stk_z
	b	l_bp_ha_meta
l_bp_ha_stk:
	mv	X0, R2
	mvwi	R2, #HSHK_BH_STACK_WORDS
l_bp_ha_stk_lp:
	ai	X0, #1
	l	R0, 0(X0)
	ai	X1, #1
	str	R0, TSR0, (R4)
	si	R2, #1, Z
	b	l_bp_ha_stk_lp
l_bp_ha_meta:
	mv	X0, SP
	l	X1, BP_HA_MPTR(X0)
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
	l	X0, BP_HA_SNAP(X0)
	l	R0, HSHK_BP_SNAP_TSR0(X0)
	setb	R0, TSR0
	ai	SP, #BP_HA_SCR
	pop	R0
	pop	X1
	pop	R3
	pop	R2
	ret

	.area	_WORK		(REL,NOLOAD)
; スロット 0–7: 件数 / 次書込 index / オーバフロー
GL_BP_HIST_META:	.ds	HSHK_BH_META_TBL
