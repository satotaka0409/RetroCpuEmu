; handshake_common.asm
; MN1613 側ハンドシェイク基礎処理
; 根拠: HandShake.mdc ## 制御概要
;       handshake_retrocpu.ts（対向IOとの初期化 ACK 同期）
;
; CPU -> IO:
;   gl_hshk_initiate_send -> gl_hshk_send_byte*N -> gl_hshk_finalize_send
; IO -> CPU（割り込み入口）:
;   gl_hshk_accept_request -> gl_hshk_recv_byte*N -> gl_hshk_finalize_recv
;   受信データは gl_hshk_recv_data に格納

.include "handshake_io.inc"
.include "handshake_struct.inc"

.global gl_handshake_interrupt_handler
.global gl_hshk_initiate_send
.global gl_hshk_send_byte
.global gl_hshk_finalize_send
.global gl_hshk_accept_request
.global gl_hshk_recv_byte
.global gl_hshk_finalize_recv
.global gl_hshk_recv_data
.global gl_hshk_wait_ack_delay

; -------------------------------------------------------
; ACK=0 チェック用の待機（50us～100us ランダム）
; @note HSHK_DELAY_50US + (乱数 & HSHK_DELAY_SPAN_MASK) ループ
; @Destruction R0, R1
; -------------------------------------------------------
gl_hshk_wait_ack_delay:
	; 簡易 LCG: state = state * 5 + 1
	ld	R0, hshk_rng
	mv	R1, R0
	sl	R0, RE			; *2
	sl	R0, RE			; *4
	a	R0, R1			; *5
	ai	R0, 1
	std	R0, hshk_rng
	andi	R0, HSHK_DELAY_SPAN_MASK	; 追加 0～31
	awi	R0, HSHK_DELAY_50US	; 合計 ≒ 50us～100us+
hshk_wad_lp:
	si	R0, 1, Z
	b	hshk_wad_lp
	ret

; -------------------------------------------------------
; HSHK_ACK==0 を確認する
; @note 50us～100us（ランダム）× 最大 HSHK_ACK0_RETRY 回（HandShake.mdc）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_ack0:
	mvi	R1, HSHK_ACK0_RETRY
hshk_wa0_lp:
	bald	gl_hshk_wait_ack_delay
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_ACK_BIT, Z
	b	hshk_wa0_busy
	mvi	R0, HSHK_OK
	ret
hshk_wa0_busy:
	si	R1, 1, Z
	b	hshk_wa0_lp
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_ACK が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_ACK_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
hshk_wait_ack:
	mv	R2, R0
	mvwi	R1, HSHK_WAIT_MAX
hshk_ack_lp:
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_ACK_BIT
	c	R0, R2, Z
	b	hshk_ack_cont
	mvi	R0, HSHK_OK
	ret
hshk_ack_cont:
	si	R1, 1, Z
	b	hshk_ack_lp
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_DACK が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DACK_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
hshk_wait_dack:
	mv	R2, R0
	mvwi	R1, HSHK_WAIT_MAX
hshk_dack_lp:
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_DACK_BIT
	c	R0, R2, Z
	b	hshk_dack_cont
	mvi	R0, HSHK_OK
	ret
hshk_dack_cont:
	si	R1, 1, Z
	b	hshk_dack_lp
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_DENA が期待値になるまで待つ
; @param R0 - 期待値（0 または HSHK_DENA_BIT）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
hshk_wait_dena:
	mv	R2, R0
	mvwi	R1, HSHK_WAIT_MAX
hshk_dena_lp:
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_DENA_BIT
	c	R0, R2, Z
	b	hshk_dena_cont
	mvi	R0, HSHK_OK
	ret
hshk_dena_cont:
	si	R1, 1, Z
	b	hshk_dena_lp
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; HSHK_REQ_1 == 0 になるまで待つ
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
hshk_wait_req1_0:
	mvwi	R1, HSHK_WAIT_MAX
hshk_req1_lp:
	rd	R0, HSHK_CTRL
	andi	R0, HSHK_REQ1_BIT, Z
	b	hshk_req1_cont
	mvi	R0, HSHK_OK
	ret
hshk_req1_cont:
	si	R1, 1, Z
	b	hshk_req1_lp
	mvi	R0, HSHK_NG
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
	eori	R1, 0xffff		; R1 = ~mask
	rd	R0, HSHK_CTRL
	and	R0, R1
	wt	R0, HSHK_CTRL
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク開始
; @note ACK=0確認 → DENA=0 → REQ_0=1 → ACK=1待ち → REQ_0=0 → ACK=0待ち
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_hshk_initiate_send:
	; 1) ACK=0 チェック
	bald	hshk_wait_ack0
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	; 2) DENA=0
	mvi	R0, HSHK_DENA_BIT
	bald	hshk_ctrl_clr

	; 3) REQ_0=1（IOへ割り込み）
	mvi	R0, HSHK_REQ0_BIT
	bald	hshk_ctrl_set

	; 4) ACK=1 待ち
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_wait_ack
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	; 5) REQ_0=0
	mvi	R0, HSHK_REQ0_BIT
	bald	hshk_ctrl_clr

	; 6) ACK=0 待ち（対向IOの初期化完了と同期）
	mvi	R0, 0
	bald	hshk_wait_ack
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_init_send_fail

	; 次 DENA は 0->1
	mvi	R0, HSHK_DENA_BIT
	std	R0, hshk_dena_lvl
	mvi	R0, HSHK_OK
	ret

hshk_init_send_fail:
	mvi	R0, HSHK_REQ0_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; CPU -> IO 1バイト送信
; @param R0 - 送信バイト（下位8bit）
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2, R3
; @note R4 は入口で退避・出口で復元する
; -------------------------------------------------------
gl_hshk_send_byte:
	push	R4
	mv	R3, R0			; data

	wt	R3, HSHK_DATA

	; DENA を次レベルへ
	ld	R4, hshk_dena_lvl
	mv	R0, R4
	andi	R0, HSHK_DENA_BIT, Z
	b	hshk_send_dena1		; lvl!=0 → set
	mvi	R0, HSHK_DENA_BIT
	bald	hshk_ctrl_clr
	b	hshk_send_wait_dack
hshk_send_dena1:
	mvi	R0, HSHK_DENA_BIT
	bald	hshk_ctrl_set

hshk_send_wait_dack:
	; DACK が DENA と同極性になるまで待つ
	ld	R0, hshk_dena_lvl
	andi	R0, HSHK_DENA_BIT, Z
	b	hshk_send_exp_dack1
	mvi	R0, 0
	b	hshk_send_do_wait_dack
hshk_send_exp_dack1:
	mvi	R0, HSHK_DACK_BIT
hshk_send_do_wait_dack:
	bald	hshk_wait_dack
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_send_fail

	; DENA レベル反転
	ld	R0, hshk_dena_lvl
	eori	R0, HSHK_DENA_BIT
	std	R0, hshk_dena_lvl

	mvi	R0, HSHK_OK
	pop	R4
	ret

hshk_send_fail:
	mvi	R0, HSHK_NG
	pop	R4
	ret

; -------------------------------------------------------
; CPU -> IO ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_hshk_finalize_send:
	mvi	R0, HSHK_DENA_BIT
	bald	hshk_ctrl_clr
	mvi	R0, 0
	bald	hshk_wait_ack
	ret

; -------------------------------------------------------
; IO -> CPU 依頼受理
; @note 割り込みハンドラから呼ぶ。DACK=0 → ACK=1 → REQ_1=0待ち → ACK=0
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_hshk_accept_request:
	; DACK=0
	mvi	R0, HSHK_DACK_BIT
	bald	hshk_ctrl_clr

	; ACK=1（受理）
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_ctrl_set

	; REQ_1=0 待ち
	bald	hshk_wait_req1_0
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_accept_fail

	; ACK=0（転送前初期化完了・対向と同期）
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_ctrl_clr

	mvi	R0, HSHK_DENA_BIT
	std	R0, hshk_dena_lvl
	mvi	R0, HSHK_OK
	ret

hshk_accept_fail:
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU 1バイト受信
; @note 受信データは gl_hshk_recv_data に格納する
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_hshk_recv_byte:
	ld	R0, hshk_dena_lvl
	bald	hshk_wait_dena
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_recv_fail

	rd	R0, HSHK_DATA
	andi	R0, 0x00ff
	std	R0, gl_hshk_recv_data

	; DACK を DENA と同極性に
	ld	R0, hshk_dena_lvl
	andi	R0, HSHK_DENA_BIT, Z
	b	hshk_recv_dack1
	mvi	R0, HSHK_DACK_BIT
	bald	hshk_ctrl_clr
	b	hshk_recv_next
hshk_recv_dack1:
	mvi	R0, HSHK_DACK_BIT
	bald	hshk_ctrl_set

hshk_recv_next:
	ld	R0, hshk_dena_lvl
	eori	R0, HSHK_DENA_BIT
	std	R0, hshk_dena_lvl
	mvi	R0, HSHK_OK
	ret

hshk_recv_fail:
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; IO -> CPU ハンドシェイク完了
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_hshk_finalize_recv:
	mvi	R0, 0
	bald	hshk_wait_dena
	mv	R1, R0
	mvi	R0, HSHK_OK
	c	R1, R0, Z
	b	hshk_fin_recv_ng

	mvi	R0, HSHK_DACK_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_OK
	ret

hshk_fin_recv_ng:
	mvi	R0, HSHK_DACK_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_ACK_BIT
	bald	hshk_ctrl_clr
	mvi	R0, HSHK_NG
	ret

; -------------------------------------------------------
; レベル2割り込み: ハンドシェイク要因
; @note INT_CAUSE=2。依頼受理まで。コマンド解釈は後続で拡張
; @Destruction R0, R1, R2
; -------------------------------------------------------
gl_handshake_interrupt_handler:
	bald	gl_hshk_accept_request
	ret

; -------------------------------------------------------
; 作業変数（コード末尾）
; -------------------------------------------------------
; ACK=0 チェック用 LCG 状態
hshk_rng:
	.word	0x1234

; 次に出す/待つ HSHK_DENA レベル（0 or HSHK_DENA_BIT）
hshk_dena_lvl:
	.word	HSHK_DENA_BIT

; 直近の受信バイト
gl_hshk_recv_data:
	.word	0
