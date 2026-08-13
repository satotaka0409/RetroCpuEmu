; handshake_write_memory.asm
; メモリ書き込み（ハンドシェイク 51h、IO→CPU）
; 根拠: HandShake.mdc「メモリ書き込み」/ boot_monitor.mdc
;
; コマンド 1B は IRQ ディスパッチ済み。残りヘッダ 8B:
;   addr32 BE + count32 BE（バイトアドレス／バイト数）。
; 以降 IO→CPU で 256B（端数はそのまま）+ チェックサムを受け、
; 一致なら RAM に書いて OK、不一致なら NG を返し同一ブロックの再送を待つ。
; 16bit CPU でも線上はバイト。パディングしない。
;
; 状態はスタック 8 ワード（_WORK は使わない）。局所 bald ヘルパは
; SP+1 が戻りなので、フレーム先頭へ ai X0,#1 してから同じオフセットを使う。
; 受信ブロックは g_malloc(HSHK_MEM_BLOCK) で確保し、復帰前に g_free。
; g_* は BALD / RET。R3-R4 は非破壊。TSR0 は退避して戻す。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_write_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_st8
	.global g_malloc
	.global g_free

HSHK_WM_FRAME		.equ	8
HSHK_WM_ADDR_HI		.equ	1
HSHK_WM_ADDR_LO		.equ	2
HSHK_WM_REM_HI		.equ	3
HSHK_WM_REM_LO		.equ	4
HSHK_WM_BLK		.equ	5
HSHK_WM_SUM		.equ	6
HSHK_WM_TSR0		.equ	7
HSHK_WM_BUF		.equ	8

; -------------------------------------------------------
; メモリ書き込み（51h ペイロード）
; @note コマンドバイトは呼び出し前に受信済み
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_write_memory:
	push	R3
	push	R4
	si	SP, #HSHK_WM_FRAME
	cpyb	R0, TSR0
	mv	X0, SP
	st	R0, HSHK_WM_TSR0(X0)
	eor	R0, R0
	st	R0, HSHK_WM_BUF(X0)
	mvwi	R0, #HSHK_MEM_BLOCK
	bald	g_malloc
	mv	R0, R0, NZ
	b	l_hshk_wm_fail
	mv	X0, SP
	st	R0, HSHK_WM_BUF(X0)

	bald	l_hshk_wm_recv_hdr
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_wm_fail

l_hshk_wm_blk_lp:
	mv	X0, SP
	l	R0, HSHK_WM_REM_HI(X0)
	l	R1, HSHK_WM_REM_LO(X0)
	or	R0, R1, NZ
	b	l_hshk_wm_ok

	bald	l_hshk_wm_pick_blk
	bald	l_hshk_wm_recv_blk
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_wm_recv_not_ok
	bald	l_hshk_wm_store_blk
	mvwi	R0, #HSHK_OK
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_wm_fail
	bald	l_hshk_wm_commit
	b	l_hshk_wm_blk_lp

l_hshk_wm_recv_not_ok:
	cwi	R0, #HSHK_NG, Z
	b	l_hshk_wm_fail
	mvwi	R0, #HSHK_NG
	bald	g_hshk_send_byte
	b	l_hshk_wm_blk_lp

l_hshk_wm_ok:
	mvwi	R0, #HSHK_OK
	b	l_hshk_wm_done
l_hshk_wm_fail:
	mvwi	R0, #HSHK_NG
l_hshk_wm_done:
	mv	X0, SP
	l	R1, HSHK_WM_BUF(X0)
	push	R0
	mv	R0, R1
	mv	R0, R0, NZ
	b	l_hshk_wm_nofree
	bald	g_free
l_hshk_wm_nofree:
	pop	R0
	mv	X0, SP
	l	R1, HSHK_WM_TSR0(X0)
	setb	R1, TSR0
	ai	SP, #HSHK_WM_FRAME
	pop	R4
	pop	R3
	ret
l_hshk_wm_recv_hdr:
	mvwi	R2, #HSHK_WM_ADDR_HI
l_hshk_wm_rh_lp:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_wm_rh_fail
	andi	R1, #0x00ff
	bswp	R4, R1
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_wm_rh_fail
	andi	R1, #0x00ff
	or	R4, R1
	mv	X0, SP
	ai	X0, #1
	a	X0, R2
	st	R4, 0(X0)
	ai	R2, #1
	cwi	R2, #HSHK_WM_BLK, Z
	b	l_hshk_wm_rh_lp
	mvwi	R0, #HSHK_OK
	ret
l_hshk_wm_rh_fail:
	mvwi	R0, #HSHK_NG
	ret

l_hshk_wm_pick_blk:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_WM_REM_HI(X0)
	mv	R0, R0, Z
	b	l_hshk_wm_pb_256
	l	R0, HSHK_WM_REM_LO(X0)
	cwi	R0, #HSHK_MEM_BLOCK, LPZ
	b	l_hshk_wm_pb_store
l_hshk_wm_pb_256:
	mvwi	R0, #HSHK_MEM_BLOCK
l_hshk_wm_pb_store:
	st	R0, HSHK_WM_BLK(X0)
	ret

l_hshk_wm_recv_blk:
	mv	X0, SP
	ai	X0, #1
	eor	R0, R0
	st	R0, HSHK_WM_SUM(X0)
	l	R2, HSHK_WM_BLK(X0)
	l	X1, HSHK_WM_BUF(X0)
l_hshk_wm_rb_lp:
	mv	R0, R2, Z
	b	l_hshk_wm_rb_go
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_wm_rb_fail
	andi	R1, #0x00ff
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_WM_SUM(X0)
	andi	R0, #0x00ff
	c	R0, R1, Z
	b	l_hshk_wm_rb_ckng
	mvwi	R0, #HSHK_OK
	ret
l_hshk_wm_rb_ckng:
	mvwi	R0, #HSHK_NG
	ret
l_hshk_wm_rb_fail:
	mvwi	R0, #HSHK_NG_OTHER
	ret
l_hshk_wm_rb_go:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_wm_rb_fail
	andi	R1, #0x00ff
	st	R1, 0(X1)
	ai	X1, #1
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_WM_SUM(X0)
	a	R0, R1
	st	R0, HSHK_WM_SUM(X0)
	si	R2, #1
	b	l_hshk_wm_rb_lp

l_hshk_wm_store_blk:
	mv	X0, SP
	ai	X0, #1
	l	R2, HSHK_WM_BLK(X0)
	l	X1, HSHK_WM_BUF(X0)
l_hshk_wm_st_lp:
	mv	R0, R2, Z
	b	l_hshk_wm_st_go
	ret
l_hshk_wm_st_go:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_WM_BLK(X0)
	s	R0, R2
	push	R0
	l	R0, HSHK_WM_ADDR_HI(X0)
	l	R1, HSHK_WM_ADDR_LO(X0)
	pop	R3
	a	R1, R3, ENZ
	b	l_hshk_wm_st_nc
	awi	R0, #1
l_hshk_wm_st_nc:
	l	R3, 0(X1)
	push	R2
	mv	R2, R3
	bald	g_hshk_mem_st8
	pop	R2
	ai	X1, #1
	si	R2, #1
	b	l_hshk_wm_st_lp

l_hshk_wm_commit:
	mv	X0, SP
	ai	X0, #1
	l	R0, HSHK_WM_ADDR_LO(X0)
	l	R1, HSHK_WM_BLK(X0)
	a	R0, R1, ENZ
	b	l_hshk_wm_c_anc
	st	R0, HSHK_WM_ADDR_LO(X0)
	l	R0, HSHK_WM_ADDR_HI(X0)
	awi	R0, #1
	st	R0, HSHK_WM_ADDR_HI(X0)
	b	l_hshk_wm_c_rem
l_hshk_wm_c_anc:
	st	R0, HSHK_WM_ADDR_LO(X0)
l_hshk_wm_c_rem:
	l	R0, HSHK_WM_REM_LO(X0)
	l	R1, HSHK_WM_BLK(X0)
	s	R0, R1, ENZ
	b	l_hshk_wm_c_snb
	st	R0, HSHK_WM_REM_LO(X0)
	l	R0, HSHK_WM_REM_HI(X0)
	swi	R0, #1
	st	R0, HSHK_WM_REM_HI(X0)
	ret
l_hshk_wm_c_snb:
	st	R0, HSHK_WM_REM_LO(X0)
	ret

