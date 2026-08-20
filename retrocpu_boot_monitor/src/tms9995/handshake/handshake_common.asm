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
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_send_byte:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_send_word:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_finalize_send:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_accept_request:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_recv_byte:
	CLR	R1
	LI	R2, #HSHK_OK
	B	(R11)

g_hshk_finalize_recv:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_wait_ena_delay:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_wait_req1_1:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_mem_map:
	LI	R1, #HSHK_NG
	B	(R11)

g_hshk_mem_ld8:
	CLR	R1
	LI	R2, #HSHK_NG
	B	(R11)

g_hshk_mem_st8:
	LI	R1, #HSHK_NG
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_HSHK_PAIR:	.blkw	1
