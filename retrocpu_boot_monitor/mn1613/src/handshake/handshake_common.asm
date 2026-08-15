; handshake_common.asm
; MN1613 CPUボード側ハンドシェイク（アセンブラ実装）
; 根拠: HandShake.mdc（HSHK_ENA / IN_DATA / OUT_DATA）
;
; CPU -> IO:
;   g_hshk_initiate_send -> g_hshk_send_byte*N -> g_hshk_finalize_send
; IO -> CPU（割り込み入口）:
;   g_hshk_accept_request -> g_hshk_recv_byte*N -> g_hshk_finalize_recv
;
; 2バイト単位: 1バイト目 DENA 0→1 → DACK 0→1、2バイト目 DENA 1→0 → DACK 1→0。
; 奇数長は finalize で 0 パッド。論理は send_byte / recv_byte のまま。
;
; 引数は第1=R0、第2=R1、第3=R2、第4以降はスタック（asm-rules.mdc）。
; g_hshk_recv_byte の受信バイトは R1。ペア途中は _SYS_PAGE0 の GL_HSHK_PAIR。
; ENA0 待ちの乱数は bios_common.asm の g_get_rnd（BALD）。待ち時間は厳密でなくてよい。
; g_* / l_* は BALD / RET。コードはセグメント 0。拡張 SBR はデータ専用。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_reg_send16
	.global g_hshk_finalize_send
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global g_hshk_wait_ena_delay
	.global g_hshk_wait_req1_1
	.global g_hshk_mem_map
	.global g_hshk_mem_ld8
	.global g_hshk_mem_st8
	.global g_get_rnd
	.global GL_HSHK_PAIR

; -------------------------------------------------------
; ENA=0 チェック用の待機（g_get_rnd でばらした粗いスピン）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_wait_ena_delay:
	push	R3
	bald	g_get_rnd
	andi	R0, #HSHK_DELAY_MASK
	awi	R0, #HSHK_DELAY_MIN
l_hshk_wad_lp:
	si	R0, #1, Z
	b	l_hshk_wad_lp
	pop	R3
	ret
; -------------------------------------------------------
; HSHK_ENA==0 を確認する
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
l_hshk_wait_ena0:
	push	R3
	mvwi	R1, #HSHK_ENA0_RETRY
l_hshk_we0_lp:
	bald	g_hshk_wait_ena_delay
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT, Z
	b	l_hshk_we0_busy
	mvwi	R0, #HSHK_OK
	pop	R3
	ret
l_hshk_we0_busy:
	si	R1, #1, Z
	b	l_hshk_we0_lp
	mvwi	R0, #HSHK_NG
	pop	R3
	ret

; -------------------------------------------------------
; HSHK_ENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_ENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_wait_ena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
l_hshk_ena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT
	c	R0, R2, Z
	b	l_hshk_ena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
l_hshk_ena_cont:
	si	R1, #1, Z
	b	l_hshk_ena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DACK が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DACK_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_wait_dack:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
l_hshk_dack_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DACK_BIT
	c	R0, R2, Z
	b	l_hshk_dack_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
l_hshk_dack_cont:
	si	R1, #1, Z
	b	l_hshk_dack_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_wait_dena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
l_hshk_dena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DENA_BIT
	c	R0, R2, Z
	b	l_hshk_dena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
l_hshk_dena_cont:
	si	R1, #1, Z
	b	l_hshk_dena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 0 になるまで待つ
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_wait_req1_0:
	mvwi	R1, #HSHK_WAIT_MAX
l_hshk_req1_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	l_hshk_req1_cont
	mvwi	R0, #HSHK_OK
	ret
l_hshk_req1_cont:
	si	R1, #1, Z
	b	l_hshk_req1_lp
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 1 になるまで待つ
; @note 割り込みを使わず IO→CPU 依頼を待つ（BIOS の応答受信）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_wait_req1_1:
	mvwi	R1, #HSHK_WAIT_MAX
l_hshk_req1s_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	l_hshk_req1s_ok
	si	R1, #1, Z
	b	l_hshk_req1s_lp
	mvwi	R0, #HSHK_NG
	ret
l_hshk_req1s_ok:
	mvwi	R0, #HSHK_OK
	ret
; -------------------------------------------------------
; 制御ポート RMW: ビットセット
; @param R0 - セットするビットマスク
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_ctrl_set:
	mv	R1, R0
	rd	R0, HSHK_CTRL
	or	R0, R1
	wt	R0, HSHK_CTRL
	ret

; -------------------------------------------------------
; 制御ポート RMW: ビットクリア
; @param R0 - クリアするビットマスク
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_ctrl_clr:
	mv	R1, R0
	eori	R1, #0xffff
	rd	R0, HSHK_CTRL
	and	R0, R1
	wt	R0, HSHK_CTRL
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク開始
; @note ENA=0確認 → DENA=0 → REQ_0=1 → ENA=1待ち → REQ_0=0
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_initiate_send:
	bald	l_hshk_wait_ena0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_init_send_fail

	bald	l_hshk_pair_reset

	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_ctrl_clr

	mvwi	R0, #HSHK_REQ0_BIT
	bald	l_hshk_ctrl_set

	mvwi	R0, #HSHK_ENA_BIT
	bald	l_hshk_wait_ena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_init_send_fail

	mvwi	R0, #HSHK_REQ0_BIT
	bald	l_hshk_ctrl_clr

	mvwi	R0, #HSHK_OK
	ret
l_hshk_init_send_fail:
	mvwi	R0, #HSHK_REQ0_BIT
	bald	l_hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret
; -------------------------------------------------------
; ペア位相を 0 にする
; @Destruction R0
; -------------------------------------------------------
l_hshk_pair_reset:
	eor	R0, R0
	st	R0, *GL_HSHK_PAIR
	ret

; -------------------------------------------------------
; 送信ユニットの奇数残りを 0 パッドで閉じる
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_flush_send:
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_SEND
	mv	R0, R0, NZ
	b	l_hshk_fs_even
	eor	R0, R0
	wt	R0, HSHK_IN_DATA
	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_ctrl_clr
	eor	R0, R0
	bald	l_hshk_wait_dack
	mv	R1, R0
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_RECV
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_fs_fail
	ret
l_hshk_fs_even:
	mvwi	R0, #HSHK_OK
	ret
l_hshk_fs_fail:
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; 受信ユニットの奇数残り（パッド）を捨てる
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_hshk_flush_recv:
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_RECV
	mv	R0, R0, NZ
	b	l_hshk_fr_even
	eor	R0, R0
	bald	l_hshk_wait_dena
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_fr_fail
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_ctrl_clr
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_SEND
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_OK
	ret
l_hshk_fr_even:
	mvwi	R0, #HSHK_OK
	ret
l_hshk_fr_fail:
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_SEND
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO 1バイト送信（2バイト単位の片方。奇数は finalize でパッド）
; @param R0 - 送信バイト（下位8bit）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_send_byte:
	push	R3
	mv	R3, R0
	bald	l_hshk_flush_recv
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_send_fail
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_SEND
	mv	R0, R0, Z
	b	l_hshk_send_2
	mv	R0, R3
	wt	R0, HSHK_IN_DATA
	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_ctrl_set
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_wait_dack
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_send_fail
	l	R0, *GL_HSHK_PAIR
	mvwi	R1, #HSHK_PAIR_SEND
	or	R0, R1
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_OK
	pop	R3
	ret
l_hshk_send_2:
	mv	R0, R3
	wt	R0, HSHK_IN_DATA
	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_ctrl_clr
	eor	R0, R0
	bald	l_hshk_wait_dack
	mv	R1, R0
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_RECV
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_send_fail
	pop	R3
	ret
l_hshk_send_fail:
	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_ctrl_clr
	eor	R0, R0
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_NG
	pop	R3
	ret
; -------------------------------------------------------
; CPU -> IO 16bit をビッグエンディアン 2 バイトで送る
; @param R0 - 送信ワード
; @return R0 - HSHK_OK / HSHK_NG（最後のバイト）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_reg_send16:
g_hshk_send_word:
	push	R3
	mv	R2, R0
	bswp	R0, R2
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	andi	R2, #0x00ff
	mv	R0, R2
	bald	g_hshk_send_byte
	pop	R3
	ret
; -------------------------------------------------------
; CPU -> IO ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_finalize_send:
	bald	l_hshk_flush_send
	eor	R0, R0
	bald	l_hshk_wait_ena
	ret
; -------------------------------------------------------
; IO -> CPU 依頼受理（割り込みハンドラから）
; @note DACK=0 → ENA=1 → REQ_1=0待ち
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_accept_request:
	bald	l_hshk_pair_reset
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_ctrl_clr

	mvwi	R0, #HSHK_ENA_BIT
	bald	l_hshk_ctrl_set

	bald	l_hshk_wait_req1_0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_hshk_accept_fail

	mvwi	R0, #HSHK_OK
	ret
l_hshk_accept_fail:
	mvwi	R0, #HSHK_ENA_BIT
	bald	l_hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret
; -------------------------------------------------------
; IO -> CPU 1バイト受信（2バイト単位の片方。奇数は finalize でパッド捨て）
; @note 受信バイトは R1（下位 8bit）
; @return R0 - HSHK_OK / HSHK_NG、R1 - 受信バイト（OK 時）
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_recv_byte:
	push	R3
	bald	l_hshk_flush_send
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_recv_fail
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_RECV
	mv	R0, R0, Z
	b	l_hshk_recv_2
	mvwi	R0, #HSHK_DENA_BIT
	bald	l_hshk_wait_dena
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_recv_fail
	rd	R0, HSHK_OUT_DATA
	andi	R0, #0x00ff
	mv	R3, R0
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_ctrl_set
	l	R0, *GL_HSHK_PAIR
	mvwi	R1, #HSHK_PAIR_RECV
	or	R0, R1
	st	R0, *GL_HSHK_PAIR
	mv	R1, R3
	mvwi	R0, #HSHK_OK
	pop	R3
	ret
l_hshk_recv_2:
	eor	R0, R0
	bald	l_hshk_wait_dena
	cwi	R0, #HSHK_OK, Z
	b	l_hshk_recv_fail
	rd	R0, HSHK_OUT_DATA
	andi	R0, #0x00ff
	mv	R3, R0
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_ctrl_clr
	l	R0, *GL_HSHK_PAIR
	andi	R0, #HSHK_PAIR_SEND
	st	R0, *GL_HSHK_PAIR
	mv	R1, R3
	mvwi	R0, #HSHK_OK
	pop	R3
	ret
l_hshk_recv_fail:
	mvwi	R0, #HSHK_DACK_BIT
	bald	l_hshk_ctrl_clr
	eor	R0, R0
	st	R0, *GL_HSHK_PAIR
	mvwi	R0, #HSHK_NG
	pop	R3
	ret
; -------------------------------------------------------
; IO -> CPU ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
g_hshk_finalize_recv:
	bald	l_hshk_flush_send
	bald	l_hshk_flush_recv
	mvwi	R0, #HSHK_ENA_BIT
	bald	l_hshk_ctrl_clr
	mvwi	R0, #HSHK_OK
	ret
; -------------------------------------------------------
; 32bit バイトアドレス → TSR0 + 論理ワード + 奇偶
; phys_word = byte_addr >> 1（18bit）。
; ボード運用: SBR 下位 2bit は 0 固定（有効値 0/4/8/C）。
;   TSR0 = phys[17:16] << 2、論理 = phys[15:0]、奇偶 = byte_addr[0]。
; @param R0 - バイトアドレス bits 31-16
; @param R1 - バイトアドレス bits 15-0
; @return R0 - 0=偶数（上位バイト）/ 1=奇数（下位バイト）
; @return R1 - 論理ワードアドレス（16bit）
; @return TSR0 - セグメント（下位 2bit=0）
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_hshk_mem_map:
	push	R3
	mv	R2, R0			; byte_hi
	mv	R3, R1			; byte_lo
	mv	R0, R1
	andi	R0, #1			; 奇偶
	; phys[15:0] = (byte_lo >> 1) | ((byte_hi & 1) << 15)
	; TBIT のビット番号は MSB=0 / LSB=15（MN1613.mdc）。byte_hi の LSB は #15。
	mv	R1, R3
	sr	R1, RE
	tbit	R2, #15, Z
	awi	R1, #0x8000
	; TSR0 = phys[17:16] << 2 = (byte_hi >> 1) << 2
	sr	R2, RE
	andi	R2, #3
	sl	R2, RE
	sl	R2, RE
	setb	R2, TSR0
	pop	R3
	ret
; -------------------------------------------------------
; 物理メモリから 1 バイト読む（ビッグエンディアン）
; @param R0 - バイトアドレス bits 31-16
; @param R1 - バイトアドレス bits 15-0
; @return R0 - データバイト（下位 8bit）
; @Destruction R0, R1, R2（TSR0 を書き換える）
; -------------------------------------------------------
g_hshk_mem_ld8:
	push	R3
	bald	g_hshk_mem_map
	mv	R2, R0
	lr	R0, TSR0, (R1)
	mv	R2, R2, Z
	b	l_hshk_mld_odd
	bswp	R0, R0
l_hshk_mld_odd:
	andi	R0, #0x00ff
	pop	R3
	ret
; -------------------------------------------------------
; 物理メモリへ 1 バイト書く（ビッグエンディアン、RMW）
; @param R0 - バイトアドレス bits 31-16
; @param R1 - バイトアドレス bits 15-0
; @param R2 - データバイト（下位 8bit）
; @Destruction R0, R1, R2（TSR0 を書き換える）
; -------------------------------------------------------
g_hshk_mem_st8:
	push	R3
	push	R4
	mv	R4, R2			; データ
	bald	g_hshk_mem_map
	mv	R2, R0			; 奇偶
	lr	R0, TSR0, (R1)
	mv	R2, R2, Z
	b	l_hshk_mst_odd
	andi	R0, #0x00ff
	bswp	R2, R4
	andi	R2, #0xff00
	or	R0, R2
	b	l_hshk_mst_wr
l_hshk_mst_odd:
	andi	R0, #0xff00
	andi	R4, #0x00ff
	or	R0, R4
l_hshk_mst_wr:
	str	R0, TSR0, (R1)
	pop	R4
	pop	R3
	ret

	.area	_SYS_PAGE0		(REL,NOLOAD)
GL_HSHK_PAIR:	.ds	1