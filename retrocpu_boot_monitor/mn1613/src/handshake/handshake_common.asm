; handshake_common.asm
; MN1613 CPUボード側ハンドシェイク（アセンブラ実装）
; 根拠: HandShake.mdc（HSHK_ENA / IN_DATA / OUT_DATA）
;
; CPU -> IO:
;   gl_hshk_initiate_send -> gl_hshk_send_byte*N -> gl_hshk_finalize_send
; IO -> CPU（割り込み入口）:
;   gl_hshk_accept_request -> gl_hshk_recv_byte*N -> gl_hshk_finalize_recv
;
; 1バイト: DENA 0→1 → DACK 0→1 → DENA 1→0 → DACK 1→0
;
; 引数は第1=R0、第2=R1、第3以降はスタック（asm-rules.mdc の呼び出し規約）。
; 受信バイトはゼロページ GL_HSHK_RECV_DATA（L/ST *）。
; ENA0 待ちの乱数は bios_common.asm の gl_get_rnd（M系列）。リンクで結合する。

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global gl_hshk_initiate_send
	.global gl_hshk_send_byte
	.global gl_hshk_finalize_send
	.global gl_hshk_accept_request
	.global gl_hshk_recv_byte
	.global gl_hshk_finalize_recv
	.global gl_hshk_wait_ena_delay
	.global gl_hshk_wait_req1_1
	.global gl_get_rnd

; -------------------------------------------------------
; ENA=0 チェック用の待機（50us～100us ランダム近似）
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_wait_ena_delay:
	bald	gl_get_rnd
	andi	R0, #HSHK_DELAY_SPAN_MASK
	awi	R0, #HSHK_DELAY_50US
hshk_wad_lp:
	si	R0, #1, Z
	b	hshk_wad_lp
	ret

; -------------------------------------------------------
; HSHK_ENA==0 を確認する
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_ena0:
	mvwi	R1, #HSHK_ENA0_RETRY
hshk_we0_lp:
	bald	gl_hshk_wait_ena_delay
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT, Z
	b	hshk_we0_busy
	mvwi	R0, #HSHK_OK
	ret
hshk_we0_busy:
	si	R1, #1, Z
	b	hshk_we0_lp
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_ENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_ENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_ena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_ena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_ENA_BIT
	c	R0, R2, Z
	b	hshk_ena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_ena_cont:
	si	R1, #1, Z
	b	hshk_ena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DACK が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DACK_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_dack:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_dack_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DACK_BIT
	c	R0, R2, Z
	b	hshk_dack_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_dack_cont:
	si	R1, #1, Z
	b	hshk_dack_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_DENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_dena:
	push	R2
	mv	R2, R0
	mvwi	R1, #HSHK_WAIT_MAX
hshk_dena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_DENA_BIT
	c	R0, R2, Z
	b	hshk_dena_cont
	mvwi	R0, #HSHK_OK
	pop	R2
	ret
hshk_dena_cont:
	si	R1, #1, Z
	b	hshk_dena_lp
	mvwi	R0, #HSHK_NG
	pop	R2
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 0 になるまで待つ
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_req1_0:
	mvwi	R1, #HSHK_WAIT_MAX
hshk_req1_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	hshk_req1_cont
	mvwi	R0, #HSHK_OK
	ret
hshk_req1_cont:
	si	R1, #1, Z
	b	hshk_req1_lp
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 1 になるまで待つ
; @note 割り込みを使わず IO→CPU 依頼を待つ（BIOS の応答受信）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_wait_req1_1:
	mvwi	R1, #HSHK_WAIT_MAX
hshk_req1s_lp:
	rd	R0, HSHK_CTRL
	andi	R0, #HSHK_REQ1_BIT, Z
	b	hshk_req1s_ok
	si	R1, #1, Z
	b	hshk_req1s_lp
	mvwi	R0, #HSHK_NG
	ret
hshk_req1s_ok:
	mvwi	R0, #HSHK_OK
	ret

; -------------------------------------------------------
; 制御ポート RMW: ビットセット
; @param R0 - セットするビットマスク
; @Destruction R0, R1
; -------------------------------------------------------
hshk_ctrl_set:
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
hshk_ctrl_clr:
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
gl_hshk_initiate_send:
	bald	hshk_wait_ena0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_set

	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_wait_ena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_OK
	ret

hshk_init_send_fail:
	mvwi	R0, #HSHK_REQ0_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO 1バイト送信
; @param R0 - 送信バイト（下位8bit）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_send_byte:
	wt	R0, HSHK_IN_DATA

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_set

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_wait_dack
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_send_fail

	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr

	eor	R0, R0
	bald	hshk_wait_dack
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_send_fail

	mvwi	R0, #HSHK_OK
	ret

hshk_send_fail:
	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_finalize_send:
	eor	R0, R0
	bald	hshk_wait_ena
	ret

; -------------------------------------------------------
; IO -> CPU 依頼受理（割り込みハンドラから）
; @note DACK=0 → ENA=1 → REQ_1=0待ち
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_accept_request:
	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr

	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_set

	bald	hshk_wait_req1_0
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_accept_fail

	mvwi	R0, #HSHK_OK
	ret

hshk_accept_fail:
	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU 1バイト受信
; @note 受信データはゼロページ GL_HSHK_RECV_DATA（ST *）に格納
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_recv_byte:
	mvwi	R0, #HSHK_DENA_BIT
	bald	hshk_wait_dena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_recv_fail

	rd	R0, HSHK_OUT_DATA
	andi	R0, #0x00ff
	st	R0, *GL_HSHK_RECV_DATA

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_set

	eor	R0, R0
	bald	hshk_wait_dena
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	hshk_recv_fail2

	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_OK
	ret

hshk_recv_fail2:
	mvwi	R0, #HSHK_DACK_BIT
	bald	hshk_ctrl_clr
hshk_recv_fail:
	mvwi	R0, #HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_finalize_recv:
	mvwi	R0, #HSHK_ENA_BIT
	bald	hshk_ctrl_clr
	mvwi	R0, #HSHK_OK
	ret
