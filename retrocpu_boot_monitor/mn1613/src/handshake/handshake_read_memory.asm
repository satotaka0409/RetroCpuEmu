; handshake_read_memory.asm
; メモリ読み出し（ハンドシェイク 13h、IO→CPU）
; 根拠: HandShake.mdc「メモリ読み出し」/ boot_monitor.mdc
;
; コマンド 1B は IRQ ディスパッチ済み。残りヘッダ 9B:
;   addr32 BE + count32 BE + パッド 0。
; 続けて count バイトを CPU→IO で送り、IO から status 1B を受ける。
; g_* は BALD / RET。R3-R4 は非破壊。TSR0 は退避して戻す。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_read_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_ld8

HSHK_RM_FRAME		.equ	5
HSHK_RM_ADDR_HI		.equ	1
HSHK_RM_ADDR_LO		.equ	2
HSHK_RM_REM_HI		.equ	3
HSHK_RM_REM_LO		.equ	4
HSHK_RM_TSR0		.equ	5

; -------------------------------------------------------
; メモリ読み出し（13h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_read_memory:
	push	R3
	push	R4
	si	SP, #HSHK_RM_FRAME
	cpyb	R0, TSR0
	mv	X0, SP
	st	R0, HSHK_RM_TSR0(X0)

	bald	l_hshk_rm_recv_hdr
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_rm_fail

l_hshk_rm_lp:
	mv	X0, SP
	l	R0, HSHK_RM_REM_HI(X0)
	l	R1, HSHK_RM_REM_LO(X0)
	or	R0, R1, NZ
	b	l_hshk_rm_stat

	l	R0, HSHK_RM_ADDR_HI(X0)
	l	R1, HSHK_RM_ADDR_LO(X0)
	bald	g_hshk_mem_ld8
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_rm_fail
	bald	l_hshk_rm_step
	b	l_hshk_rm_lp

l_hshk_rm_stat:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_rm_fail
	andi	R1, #0x00ff
	cwi	R1, #HSHK_OK, Z
	b	l_hshk_rm_fail
	mvwi	R0, #HSHK_OK
	b	l_hshk_rm_done
l_hshk_rm_fail:
	mvwi	R0, #HSHK_NG
l_hshk_rm_done:
	mv	X0, SP
	l	R1, HSHK_RM_TSR0(X0)
	setb	R1, TSR0
	ai	SP, #HSHK_RM_FRAME
	pop	R4
	pop	R3
	ret

l_hshk_rm_recv_hdr:
	mvwi	R2, #HSHK_RM_ADDR_HI
l_hshk_rm_rh_lp:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_rm_rh_fail
	andi	R1, #0x00ff
	bswp	R4, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_rm_rh_fail
	andi	R1, #0x00ff
	or	R4, R1
	mv	X0, SP
	ai	X0, #1
	a	X0, R2
	st	R4, 0(X0)
	ai	R2, #1
	cwi	R2, #HSHK_RM_TSR0, Z
	b	l_hshk_rm_rh_lp
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_rm_rh_fail
	mvwi	R0, #HSHK_OK
	ret
l_hshk_rm_rh_fail:
	mvwi	R0, #HSHK_NG
	ret

l_hshk_rm_step:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_RM_ADDR_LO(X0)
	awi	R0, #1, ENZ
	b	l_hshk_rm_a_nc
	st	R0, HSHK_RM_ADDR_LO(X0)
	l	R0, HSHK_RM_ADDR_HI(X0)
	awi	R0, #1
	st	R0, HSHK_RM_ADDR_HI(X0)
	b	l_hshk_rm_rem
l_hshk_rm_a_nc:
	st	R0, HSHK_RM_ADDR_LO(X0)
l_hshk_rm_rem:
	l	R0, HSHK_RM_REM_LO(X0)
	swi	R0, #1, ENZ
	b	l_hshk_rm_r_nc
	st	R0, HSHK_RM_REM_LO(X0)
	l	R0, HSHK_RM_REM_HI(X0)
	swi	R0, #1
	st	R0, HSHK_RM_REM_HI(X0)
	ret
l_hshk_rm_r_nc:
	st	R0, HSHK_RM_REM_LO(X0)
	ret
