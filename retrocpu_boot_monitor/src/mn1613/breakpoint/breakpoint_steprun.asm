; breakpoint_steprun.asm
; 1 命令ステップ（CPLD ワンショット。比較器は使わない）
; 根拠: breakpoint.mdc「ステップ実行」/ HandShake.mdc 18h・1Bh /
;   MN1613_CPUボードメモリ_IOマップ.mdc（0036=ENA / 0037=DELAY）
;
; 18h 方式 1: GL_BP_STEP_ARM を立て、OK を返す。ENA はここでは上げない
;   （ハンドラ途中のフェッチで発火するため）。INT1 の LPSW 1 直前に
;   g_step_arm_cpld が 0037h=delay・0036h=1 を書く。
; 要因 1: 1Bh（アドレス・レジスタ・スタック 16 ワード）を送りモニタ HALT（R0=1）。
; 履歴リングには書かない。

	.cpu	mn1613

	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_break_resume
	.global g_step_arm_cpld
	.global g_step_interrupt_handler
	.global GL_BP_STEP_ARM
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_initiate_send
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_finalize_recv

; -------------------------------------------------------
; ブレイク復帰（コマンド 18h）
; @note IO→CPU 転送中。コマンド 1B 受信済み。残り 1B: 実行方式。
; @note 0=通常再開（ENA を上げない）/ 1=ステップ（GL_BP_STEP_ARM=1）。
; @return R0 - 線上 status（OK / NG）
; @Destruction R0, R1, R2（R3–R4 は退避）
; -------------------------------------------------------
g_hshk_break_resume:
	push	R3
	push	R4
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_sr_61_ng
	andi	R1, #0x00ff
	; 方式 >= 2 は NG。設定は変えない
	cwi	R1, #HSHK_RESUME_LIMIT, M
	b	l_sr_61_ng
	b	l_sr_61_ok
l_sr_61_ng:
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	pop	R4
	pop	R3
	ret
l_sr_61_ok:
	mvwi	X1, #GL_BP_STEP_ARM
	st	R1, 0(X1)
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; LPSW 1 の直前に CPLD を武装する（INT1 エピローグから BALD）。
; @note GL_BP_STEP_ARM≠0 のときだけ 0037h=delay / 0036h=1 にして
;   フラグを落とす。通常再開では DELAY/ENA を触らない。
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_step_arm_cpld:
	mvwi	X1, #GL_BP_STEP_ARM
	l	R0, 0(X1)
	or	R0, R0, Z
	b	l_sr_arm_go
	ret
l_sr_arm_go:
	eor	R0, R0
	st	R0, 0(X1)
	mvwi	R0, #STEP_BRK_DELAY_1STEP
	wt	R0, IO_STEP_BRK_DELAY
	mvi	R0, #1
	wt	R0, IO_STEP_BRK_ENA
	ret

; -------------------------------------------------------
; ステップヒット（INT1 / INT1_CAUSE=1）
; @return R0 - 1（モニタ HALT）。1Bh 失敗でも HALT
; @Destruction R0, R1, R2（R3–R4 は退避）
; -------------------------------------------------------
g_step_interrupt_handler:
	push	R3
	push	R4
	bald	g_hshk_initiate_send
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_cmd
	bd	l_sr_nt_fail
l_sr_nt_cmd:
	mvwi	R0, #HSHK_CMD_STEP_NOTIFY
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_cmdpad
	bd	l_sr_nt_fail
l_sr_nt_cmdpad:
	; HandShake.mdc: 位置00 = cmd + pad(0) → 合計 60B
	eor	R0, R0
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_addr
	bd	l_sr_nt_fail
l_sr_nt_addr:
	eor	R0, R0
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_ic
	bd	l_sr_nt_fail
l_sr_nt_ic:
	l	R0, *INT1_IC_SAVE
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_r0
	bd	l_sr_nt_fail
l_sr_nt_r0:
	; INT2 後: SP+1=R4(本関数) … SP+12=PSHM の R0。call() 単体では不定
	mv	X1, SP
	l	R0, 12(X1)
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_r1
	bd	l_sr_nt_fail
l_sr_nt_r1:
	mv	X1, SP
	l	R0, 11(X1)
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_r2
	bd	l_sr_nt_fail
l_sr_nt_r2:
	mv	X1, SP
	l	R0, 10(X1)
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_r3
	bd	l_sr_nt_fail
l_sr_nt_r3:
	mv	X1, SP
	l	R0, 9(X1)
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_r4
	bd	l_sr_nt_fail
l_sr_nt_r4:
	mv	X1, SP
	l	R0, 8(X1)
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_sp
	bd	l_sr_nt_fail
l_sr_nt_sp:
	mv	R0, SP
	ai	R0, #12
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_str
	bd	l_sr_nt_fail
l_sr_nt_str:
	l	R0, *INT1_STR_SAVE
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_ic2
	bd	l_sr_nt_fail
l_sr_nt_ic2:
	l	R0, *INT1_IC_SAVE
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_sbr
	bd	l_sr_nt_fail
l_sr_nt_sbr:
	cpyb	R0, OSR0
	andi	R0, #0x000f
	bswp	R0, R0
	cpyb	R1, SSBR
	andi	R1, #0x000f
	or	R0, R1
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_tsr
	bd	l_sr_nt_fail
l_sr_nt_tsr:
	mv	X1, SP
	l	R0, 7(X1)
	andi	R0, #0x000f
	bswp	R0, R0
	l	R1, 6(X1)
	andi	R1, #0x000f
	or	R0, R1
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_npp
	bd	l_sr_nt_fail
l_sr_nt_npp:
	cpys	R0, NPP
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_pad
	bd	l_sr_nt_fail
l_sr_nt_pad:
	eor	R0, R0
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_stk
	bd	l_sr_nt_fail
l_sr_nt_stk:
	mv	X1, SP
	ai	X1, #12
	mvwi	R2, #HSHK_BH_STACK_WORDS
l_sr_nt_stk_lp:
	ai	X1, #1
	l	R0, 0(X1)
	push	R2
	push	X1
	bald	g_hshk_send_word
	pop	X1
	pop	R2
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_stk_ok
	bd	l_sr_nt_fail
l_sr_nt_stk_ok:
	si	R2, #1, Z
	b	l_sr_nt_stk_lp
	bald	g_hshk_finalize_send
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_wait
	bd	l_sr_nt_fail
l_sr_nt_wait:
	bald	g_hshk_wait_req1_1
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_accept
	bd	l_sr_nt_fail
l_sr_nt_accept:
	bald	g_hshk_accept_request
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_recv
	bd	l_sr_nt_fail
l_sr_nt_recv:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_sr_nt_done
	bald	g_hshk_finalize_recv
	bd	l_sr_nt_fail
l_sr_nt_done:
	bald	g_hshk_finalize_recv
l_sr_nt_fail:
	mvi	R0, #1
	pop	R4
	pop	R3
	ret

	.area	_USR_PAGE0	(REL,NOLOAD)
; 18h 方式 1 のとき 1。g_step_arm_cpld が ENA を上げて 0 に戻す
GL_BP_STEP_ARM:	.ds	1
