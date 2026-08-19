; handshake_undef.asm
; 未定義命令実行通知（ハンドシェイク 13h）
; 根拠: HandShake.mdc「未定義命令実行通知」/ boot_monitor.mdc
;
; 線上 送信 59B: 13h + addr32 + レジスタ + NPP + pad + スタック16語 → 受信 1B: status
; レジスタは GL_UNDEF_INST_REG（g_write_cpu_registers 退避）をそのまま使う。
;
; 引数は第1=R0（互換のため未使用。旧 Bit0 指定は無視）。
; R3-R4 は非破壊（R0–R2 は破壊可／戻り可）なので先頭で PUSH し、復帰前に逆順で POP する。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bios_undef_led
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global GL_UNDEF_INST_REG

; -------------------------------------------------------
; 未定義命令実行通知（13h）
; @note 応答はハンドシェイク割り込みを使わず REQ_1 のポーリングで受け取る
; @note 呼び出しは BALD、戻りは RET（asm-rules.mdc: g_*）
; @param R0 - 互換のため未使用（旧 Bit0 指定）
; @return R0 - IO ボードのステータス（HSHK_OK / HSHK_NG）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_undef_led:
	push	R3
	push	R4
	cpyb	R4, TSR0

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	mvwi	R0, #HSHK_CMD_UNDEF_LED
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	; addr32: 上位 16bit は 0、下位 16bit は退避 IC
	eor	R0, R0
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	mvwi	X0, #GL_UNDEF_INST_REG
	l	R0, HSHK_REG_W_IC(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	; R0..R4, SP, STR, IC, CSBR|SSBR, TSR0|TSR1（10 語）を送る
	mvwi	X0, #GL_UNDEF_INST_REG
	l	R0, HSHK_REG_W_R0(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_R1(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_R2(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_R3(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_R4(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_SP(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_STR(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_IC(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_CSBR_SSBR(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	l	R0, HSHK_REG_W_TSR0_1(X0)
	bald	g_hshk_send_word
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	; NPP は上位バイトのみ有効なので下位8bitへ詰めて送る
	mvwi	X0, #GL_UNDEF_INST_REG
	l	R0, HSHK_REG_W_NPP(X0)
	bswp	R0, R0
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	eor	R0, R0
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	; スタック 16 語（GL_UNDEF_INST_REG の SP と SSBR を使って読む）
	mvwi	X0, #GL_UNDEF_INST_REG
	l	R3, HSHK_REG_W_SP(X0)
	l	R2, HSHK_REG_W_CSBR_SSBR(X0)
	andi	R2, #0x000f
	setb	R2, TSR0
	mvwi	R2, #HSHK_BH_STACK_WORDS
l_undef_led_stk_lp:
	ai	R3, #1
	lr	R0, TSR0, (R3)
	push	R2
	push	R3
	bald	g_hshk_send_word
	pop	R3
	pop	R2
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail
	si	R2, #1, Z
	b	l_undef_led_stk_lp
	mv	R0, R4
	setb	R0, TSR0

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	bd	l_undef_led_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	bd	l_undef_led_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_undef_led_done

l_undef_led_recv_fail:
	bald	g_hshk_finalize_recv
l_undef_led_fail:
	mv	R0, R4
	setb	R0, TSR0
	mvwi	R0, #HSHK_NG
l_undef_led_done:
	pop	R4
	pop	R3
	ret