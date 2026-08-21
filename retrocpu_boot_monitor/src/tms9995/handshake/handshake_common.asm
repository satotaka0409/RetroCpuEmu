; ハンドシェイク線制御（TMS9995）
; 呼出規約: BL / B (R11)。第1引数 R2、ステータス R2、追加の戻り R3。
; 本ファイルの公開ルーチンは **R0–R3 と R12 のみ破壊**し、R4–R9 / R10 / R11 を保つ。
; 上位（BIOS・IRQ ハンドラ）が転送をまたいでアドレスやカウンタを持てるようにするため。
; ネストする経路は R11 をスタック（R10）へ退避する。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_finalize_send
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global g_hshk_wait_ena_delay
	.global g_hshk_wait_req1_1
	.global g_hshk_mem_map
	.global g_hshk_mem_ld8
	.global g_hshk_mem_st8
	.global GL_HSHK_PAIR

	.area	_CODE		(REL,CON)

; CPU→IO 転送を開始する（OUT_DENA=0 → OUT_REQ=1）
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_initiate_send:
	CLR	R0
	MOV	R0, GL_HSHK_PAIR

	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	SBO	#HSHK_OUT_REQ_BIT
	LI	R2, #HSHK_OK
	B	(R11)

; CPU→IO 1バイト送信（2バイト単位ペアの片方）
; @param R2 - 送信バイト（下位 8bit）
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_send_byte:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R3
	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_SEND
	JNE	l_hshk_send_phase2

	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBO	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_1
	CI	R2, #HSHK_OK
	JNE	l_hshk_send_fail

	MOV	GL_HSHK_PAIR, R1
	ORI	R1, #HSHK_PAIR_SEND
	MOV	R1, GL_HSHK_PAIR
	JMP	l_hshk_send_ok

l_hshk_send_phase2:
	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_0
	CI	R2, #HSHK_OK
	JNE	l_hshk_send_fail

	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_RECV
	MOV	R1, GL_HSHK_PAIR

l_hshk_send_ok:
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_hshk_send_fail:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	SBZ	#HSHK_OUT_DENA_BIT
	CLR	R0
	MOV	R0, GL_HSHK_PAIR
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)

; CPU→IO 16bit 送信（ビッグエンディアン）
; @param R2 - 送信ワード（16bit）
; @return R2 - HSHK_OK / HSHK_NG（最後に送ったバイトの結果）
g_hshk_send_word:
	DECT	R10
	MOV	R11, (R10)
	DECT	R10
	MOV	R2, (R10)
	SWPB	R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_hshk_send_word_done

	MOV	(R10), R2
	ANDI	R2, #0x00ff
	BL	g_hshk_send_byte

l_hshk_send_word_done:
	AI	R10, #2
	MOV	(R10)+, R11
	B	(R11)

; CPU→IO 転送を完了する（ペア途中なら 0 パッドを送る）
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_finalize_send:
	DECT	R10
	MOV	R11, (R10)
	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_SEND
	JEQ	l_hshk_finalize_send_done

	CLR	R3
	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_0
	CI	R2, #HSHK_OK
	JNE	l_hshk_finalize_send_fail

	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_RECV
	MOV	R1, GL_HSHK_PAIR

l_hshk_finalize_send_done:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_hshk_finalize_send_fail:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)

; IO→CPU 依頼を受理する（IN_DACK=0）
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_accept_request:
	CLR	R0
	MOV	R0, GL_HSHK_PAIR

	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT

	LI	R2, #HSHK_OK
	B	(R11)

; IO→CPU 1バイト受信（2バイト単位ペアの片方）
; @return R2 - HSHK_OK / HSHK_NG
; @return R3 - 受信バイト（下位 8bit。NG 時は 0）
g_hshk_recv_byte:
	DECT	R10
	MOV	R11, (R10)
	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_RECV
	JNE	l_hshk_recv_phase2

	BL	l_hshk_wait_in_dena_1
	CI	R2, #HSHK_OK
	JNE	l_hshk_recv_fail

	LI	R12, #HSHK_IN_DATA_BASE
	STCR	R3, #8
	ANDI	R3, #0x00ff
	LI	R12, #0
	SBO	#HSHK_IN_DACK_BIT

	MOV	GL_HSHK_PAIR, R1
	ORI	R1, #HSHK_PAIR_RECV
	MOV	R1, GL_HSHK_PAIR
	JMP	l_hshk_recv_ok

l_hshk_recv_phase2:
	BL	l_hshk_wait_in_dena_0
	CI	R2, #HSHK_OK
	JNE	l_hshk_recv_fail

	LI	R12, #HSHK_IN_DATA_BASE
	STCR	R3, #8
	ANDI	R3, #0x00ff
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT

	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_SEND
	MOV	R1, GL_HSHK_PAIR

l_hshk_recv_ok:
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_hshk_recv_fail:
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT
	CLR	R0
	MOV	R0, GL_HSHK_PAIR
	CLR	R3
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)

; IO→CPU 転送を完了する
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_finalize_recv:
	DECT	R10
	MOV	R11, (R10)
	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_RECV
	JEQ	l_hshk_finalize_recv_done

	BL	l_hshk_wait_in_dena_0
	CI	R2, #HSHK_OK
	JNE	l_hshk_finalize_recv_fail
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT
	MOV	GL_HSHK_PAIR, R1
	ANDI	R1, #HSHK_PAIR_SEND
	MOV	R1, GL_HSHK_PAIR

l_hshk_finalize_recv_done:
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_hshk_finalize_recv_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)

; HSHK_ENA の立ち上がり待ちに使う短いディレイ
; @return R2 - HSHK_OK
g_hshk_wait_ena_delay:
	LI	R0, #0x0010
l_hshk_delay_loop:
	AI	R0, #-1
	JNE	l_hshk_delay_loop
	LI	R2, #HSHK_OK
	B	(R11)

; IO→CPU 依頼（HSHK_IN_REQ=1）をポーリングで待つ
; @return R2 - HSHK_OK / HSHK_NG（待ち上限超過）
g_hshk_wait_req1_1:
	DECT	R10
	MOV	R11, (R10)
	BL	l_hshk_wait_req1_1
	MOV	(R10)+, R11
	B	(R11)

; 16bit 平アドレスのバイトアクセス（SBR 無し）
; @param R2 - バイトアドレス下位 16bit（上位は無視）
; @return R2 - ワードアドレス
; @return R3 - 奇偶（0=偶数=上位バイト / 1=奇数=下位バイト）
g_hshk_mem_map:
	MOV	R2, R3
	ANDI	R3, #1
	SRL	R2, #1
	B	(R11)

; 平アドレス 1 バイト読み出し
; @param R2 - バイトアドレス
; @return R2 - HSHK_OK / HSHK_NG
; @return R3 - データ（下位 8bit）
g_hshk_mem_ld8:
	DECT	R10
	MOV	R11, (R10)
	BL	g_hshk_mem_map
	MOV	(R2), R0
	MOV	R3, R3
	JNE	l_hshk_mld_odd
	SWPB	R0
l_hshk_mld_odd:
	MOV	R0, R3
	ANDI	R3, #0x00ff
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

; 平アドレス 1 バイト書き込み
; @param R2 - バイトアドレス
; @param R3 - データ（下位 8bit）
; @return R2 - HSHK_OK / HSHK_NG
g_hshk_mem_st8:
	DECT	R10
	MOV	R11, (R10)
	MOV	R3, R1
	BL	g_hshk_mem_map
	MOV	(R2), R0
	MOV	R3, R3
	JNE	l_hshk_mst_odd
	ANDI	R0, #0x00ff
	SWPB	R1
	ANDI	R1, #0xff00
	SOC	R1, R0
	JMP	l_hshk_mst_wr
l_hshk_mst_odd:
	ANDI	R0, #0xff00
	ANDI	R1, #0x00ff
	SOC	R1, R0
l_hshk_mst_wr:
	MOV	R0, (R2)
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_hshk_wait_out_dack_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_out_dack_1_lp:
	LI	R12, #0
	TB	#HSHK_OUT_DACK_BIT
	JEQ	l_hshk_wait_out_dack_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_out_dack_1_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_out_dack_1_ok:
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_wait_out_dack_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_out_dack_0_lp:
	LI	R12, #0
	TB	#HSHK_OUT_DACK_BIT
	JNE	l_hshk_wait_out_dack_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_out_dack_0_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_out_dack_0_ok:
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_wait_in_dena_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_in_dena_1_lp:
	LI	R12, #0
	TB	#HSHK_IN_DENA_BIT
	JEQ	l_hshk_wait_in_dena_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_in_dena_1_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_in_dena_1_ok:
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_wait_in_dena_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_in_dena_0_lp:
	LI	R12, #0
	TB	#HSHK_IN_DENA_BIT
	JNE	l_hshk_wait_in_dena_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_in_dena_0_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_in_dena_0_ok:
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_wait_req1_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_req1_1_lp:
	LI	R12, #0
	TB	#HSHK_IN_REQ_BIT
	JEQ	l_hshk_wait_req1_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_req1_1_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_req1_1_ok:
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_wait_req1_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_req1_0_lp:
	LI	R12, #0
	TB	#HSHK_IN_REQ_BIT
	JNE	l_hshk_wait_req1_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_req1_0_lp
	LI	R2, #HSHK_NG
	B	(R11)
l_hshk_wait_req1_0_ok:
	LI	R2, #HSHK_OK
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_HSHK_PAIR:	.blkw	1
