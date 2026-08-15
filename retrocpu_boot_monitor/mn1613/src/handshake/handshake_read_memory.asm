; handshake_read_memory.asm
; メモリ読み出し（ハンドシェイク 13h、IO→CPU）
; 根拠: HandShake.mdc「メモリ読み出し」/ boot_monitor.mdc
;
; コマンド 1B は IRQ ディスパッチ済み。残りヘッダ 8B:
;   addr32 BE + count32 BE（バイトアドレス／バイト数）。
; 以降 256B（端数はそのまま）+ チェックサム（バイト加算の下位 8bit）を
; CPU→IO で送り、OK/NG を受け取る。NG なら同一ブロックを再送。
; 16bit CPU でも線上はバイト。パディングしない。
;
; 作業域はスタック 7 ワード（_WORK は使わない）。局所 bald ヘルパは
; SP+1 が戻りなので、フレーム先頭へ ai X0,#1 してから同じオフセットを使う。
; g_* は BALD / RET。R3-R4 は非破壊。TSR0 は退避して戻す。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_read_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_ld8

HSHK_RM_FRAME		.equ	7
HSHK_RM_ADDR_HI		.equ	1
HSHK_RM_ADDR_LO		.equ	2
HSHK_RM_REM_HI		.equ	3
HSHK_RM_REM_LO		.equ	4
HSHK_RM_BLK		.equ	5
HSHK_RM_SUM		.equ	6
HSHK_RM_TSR0		.equ	7

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

l_hshk_rm_blk_lp:
	mv	X0, SP
	l	R0, HSHK_RM_REM_HI(X0)
	l	R1, HSHK_RM_REM_LO(X0)
	or	R0, R1, NZ
	b	l_hshk_rm_ok

	bald	l_hshk_rm_pick_blk
	bald	l_hshk_rm_send_blk
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_rm_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_rm_fail
	andi	R1, #0x00ff
	cwi	R1, #HSHK_OK, Z
	b	l_hshk_rm_blk_lp

	bald	l_hshk_rm_commit
	b	l_hshk_rm_blk_lp

l_hshk_rm_ok:
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
	cwi	R2, #HSHK_RM_BLK, Z
	b	l_hshk_rm_rh_lp
	mvwi	R0, #HSHK_OK
	ret
l_hshk_rm_rh_fail:
	mvwi	R0, #HSHK_NG
	ret

l_hshk_rm_pick_blk:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_RM_REM_HI(X0)
	mv	R0, R0, Z
	b	l_hshk_rm_pb_256
	l	R0, HSHK_RM_REM_LO(X0)
	cwi	R0, #HSHK_MEM_BLOCK, LPZ
	b	l_hshk_rm_pb_store
l_hshk_rm_pb_256:
	mvwi	R0, #HSHK_MEM_BLOCK
l_hshk_rm_pb_store:
	st	R0, HSHK_RM_BLK(X0)
	ret

l_hshk_rm_send_blk:
	mv	X0, SP
	ai	X0, #1
	eor	R0, R0
	st	R0, HSHK_RM_SUM(X0)
	l	R2, HSHK_RM_BLK(X0)
	eor	R4, R4
l_hshk_rm_sb_lp:
	mv	R0, R2, Z
	b	l_hshk_rm_sb_go
	l	R0, HSHK_RM_SUM(X0)
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	ret
l_hshk_rm_sb_go:
	l	R0, HSHK_RM_ADDR_HI(X0)
	l	R1, HSHK_RM_ADDR_LO(X0)
	a	R1, R4, ENZ
	b	l_hshk_rm_sb_nc
	awi	R0, #1
l_hshk_rm_sb_nc:
	push	R2			; ブロック残バイト（mem_ld8 は R2 を破壊する）
	bald	g_hshk_mem_ld8
	pop	R2
	andi	R0, #0x00ff
	mv	X0, SP
	ai	X0, #1			; フレーム再取得
	l	R1, HSHK_RM_SUM(X0)
	a	R1, R0
	st	R1, HSHK_RM_SUM(X0)
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_rm_sb_fail
	mv	X0, SP
	ai	X0, #1
	ai	R4, #1
	si	R2, #1
	b	l_hshk_rm_sb_lp
l_hshk_rm_sb_fail:
	mvwi	R0, #HSHK_NG
	ret

l_hshk_rm_commit:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_RM_ADDR_LO(X0)
	l	R1, HSHK_RM_BLK(X0)
	a	R0, R1, ENZ
	b	l_hshk_rm_c_anc
	st	R0, HSHK_RM_ADDR_LO(X0)
	l	R0, HSHK_RM_ADDR_HI(X0)
	awi	R0, #1
	st	R0, HSHK_RM_ADDR_HI(X0)
	b	l_hshk_rm_c_rem
l_hshk_rm_c_anc:
	st	R0, HSHK_RM_ADDR_LO(X0)
l_hshk_rm_c_rem:
	l	R0, HSHK_RM_REM_LO(X0)
	l	R1, HSHK_RM_BLK(X0)
	s	R0, R1, ENZ
	b	l_hshk_rm_c_snb
	st	R0, HSHK_RM_REM_LO(X0)
	l	R0, HSHK_RM_REM_HI(X0)
	swi	R0, #1
	st	R0, HSHK_RM_REM_HI(X0)
	ret
l_hshk_rm_c_snb:
	st	R0, HSHK_RM_REM_LO(X0)
	ret

