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

g_hshk_initiate_send:
	CLR	R0
	MOV	R0, GL_HSHK_PAIR

	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	SBO	#HSHK_OUT_REQ_BIT
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_send_byte:
	MOV	R1, R3
	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_SEND
	JNE	l_hshk_send_phase2

	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBO	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_1
	CI	R1, #HSHK_OK
	JNE	l_hshk_send_fail

	MOV	GL_HSHK_PAIR, R4
	ORI	R4, #HSHK_PAIR_SEND
	MOV	R4, GL_HSHK_PAIR
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_send_phase2:
	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_0
	CI	R1, #HSHK_OK
	JNE	l_hshk_send_fail

	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_RECV
	MOV	R4, GL_HSHK_PAIR
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_send_fail:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	SBZ	#HSHK_OUT_DENA_BIT
	CLR	R0
	MOV	R0, GL_HSHK_PAIR
	LI	R1, #HSHK_NG
	B	(R11)

g_hshk_send_word:
	MOV	R1, R3
	SWPB	R3
	MOV	R3, R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_hshk_send_word_done

	MOV	R3, R1
	SWPB	R1
	ANDI	R1, #0x00ff
	BL	g_hshk_send_byte

l_hshk_send_word_done:
	B	(R11)

g_hshk_finalize_send:
	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_SEND
	JEQ	l_hshk_finalize_send_done

	CLR	R3
	LI	R12, #HSHK_OUT_DATA_BASE
	LDCR	R3, #8
	LI	R12, #0
	SBZ	#HSHK_OUT_DENA_BIT
	BL	l_hshk_wait_out_dack_0
	CI	R1, #HSHK_OK
	JNE	l_hshk_finalize_send_fail

	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_RECV
	MOV	R4, GL_HSHK_PAIR

l_hshk_finalize_send_done:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_finalize_send_fail:
	LI	R12, #0
	SBZ	#HSHK_OUT_REQ_BIT
	LI	R1, #HSHK_NG
	B	(R11)

g_hshk_accept_request:
	CLR	R0
	MOV	R0, GL_HSHK_PAIR

	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT

	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_recv_byte:
	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_RECV
	JNE	l_hshk_recv_phase2

	BL	l_hshk_wait_in_dena_1
	CI	R1, #HSHK_OK
	JNE	l_hshk_recv_fail

	LI	R12, #HSHK_IN_DATA_BASE
	STCR	R1, #8
	ANDI	R1, #0x00ff
	LI	R12, #0
	SBO	#HSHK_IN_DACK_BIT

	MOV	GL_HSHK_PAIR, R4
	ORI	R4, #HSHK_PAIR_RECV
	MOV	R4, GL_HSHK_PAIR
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_recv_phase2:
	BL	l_hshk_wait_in_dena_0
	CI	R1, #HSHK_OK
	JNE	l_hshk_recv_fail

	LI	R12, #HSHK_IN_DATA_BASE
	STCR	R1, #8
	ANDI	R1, #0x00ff
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT

	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_SEND
	MOV	R4, GL_HSHK_PAIR
	LI	R2, #HSHK_OK
	B	(R11)

l_hshk_recv_fail:
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT
	CLR	R0
	MOV	R0, GL_HSHK_PAIR
	CLR	R1
	LI	R2, #HSHK_NG
	B	(R11)

g_hshk_finalize_recv:
	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_RECV
	JEQ	l_hshk_finalize_recv_done

	BL	l_hshk_wait_in_dena_0
	CI	R1, #HSHK_OK
	JNE	l_hshk_finalize_recv_fail
	LI	R12, #0
	SBZ	#HSHK_IN_DACK_BIT
	MOV	GL_HSHK_PAIR, R4
	ANDI	R4, #HSHK_PAIR_SEND
	MOV	R4, GL_HSHK_PAIR

l_hshk_finalize_recv_done:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_finalize_recv_fail:
	LI	R1, #HSHK_NG
	B	(R11)

g_hshk_wait_ena_delay:
	LI	R0, #0x0010
l_hshk_delay_loop:
	AI	R0, #-1
	JNE	l_hshk_delay_loop
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_wait_req1_1:
	BL	l_hshk_wait_req1_1
	B	(R11)

; 16bit 平アドレスのバイトアクセス（SBR 無し）
; param R1 バイトアドレス下位 16bit（上位は無視）
; return R1 ワードアドレス、R0 奇偶（0=偶数上位バイト / 1=奇数下位）
g_hshk_mem_map:
	MOV	R1, R0
	ANDI	R0, #1
	SRL	R1, #1
	LI	R2, #HSHK_OK
	B	(R11)

; param R1 バイトアドレス
; return R1 データ下位 8bit、R2 OK/NG
g_hshk_mem_ld8:
	MOV	R11, R8
	BL	g_hshk_mem_map
	MOV	(R1), R3
	MOV	R0, R0
	JNE	l_hshk_mld_odd
	SWPB	R3
l_hshk_mld_odd:
	MOV	R3, R1
	ANDI	R1, #0x00ff
	LI	R2, #HSHK_OK
	B	(R8)

; param R1 バイトアドレス、R2 データ下位 8bit
; return R1 OK/NG
g_hshk_mem_st8:
	MOV	R11, R8
	MOV	R2, R4
	BL	g_hshk_mem_map
	MOV	(R1), R3
	MOV	R0, R0
	JNE	l_hshk_mst_odd
	ANDI	R3, #0x00ff
	SWPB	R4
	ANDI	R4, #0xff00
	SOC	R4, R3
	JMP	l_hshk_mst_wr
l_hshk_mst_odd:
	ANDI	R3, #0xff00
	ANDI	R4, #0x00ff
	SOC	R4, R3
l_hshk_mst_wr:
	MOV	R3, (R1)
	LI	R1, #HSHK_OK
	B	(R8)

l_hshk_wait_out_dack_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_out_dack_1_lp:
	LI	R12, #0
	TB	#HSHK_OUT_DACK_BIT
	JEQ	l_hshk_wait_out_dack_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_out_dack_1_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_out_dack_1_ok:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_wait_out_dack_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_out_dack_0_lp:
	LI	R12, #0
	TB	#HSHK_OUT_DACK_BIT
	JNE	l_hshk_wait_out_dack_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_out_dack_0_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_out_dack_0_ok:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_wait_in_dena_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_in_dena_1_lp:
	LI	R12, #0
	TB	#HSHK_IN_DENA_BIT
	JEQ	l_hshk_wait_in_dena_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_in_dena_1_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_in_dena_1_ok:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_wait_in_dena_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_in_dena_0_lp:
	LI	R12, #0
	TB	#HSHK_IN_DENA_BIT
	JNE	l_hshk_wait_in_dena_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_in_dena_0_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_in_dena_0_ok:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_wait_req1_1:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_req1_1_lp:
	LI	R12, #0
	TB	#HSHK_IN_REQ_BIT
	JEQ	l_hshk_wait_req1_1_ok
	AI	R0, #-1
	JNE	l_hshk_wait_req1_1_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_req1_1_ok:
	LI	R1, #HSHK_OK
	B	(R11)

l_hshk_wait_req1_0:
	LI	R0, #HSHK_WAIT_MAX
l_hshk_wait_req1_0_lp:
	LI	R12, #0
	TB	#HSHK_IN_REQ_BIT
	JNE	l_hshk_wait_req1_0_ok
	AI	R0, #-1
	JNE	l_hshk_wait_req1_0_lp
	LI	R1, #HSHK_NG
	B	(R11)
l_hshk_wait_req1_0_ok:
	LI	R1, #HSHK_OK
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_HSHK_PAIR:	.blkw	1
