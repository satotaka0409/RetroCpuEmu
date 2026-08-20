; BIOS 共通（乱数・memcpy・malloc）

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_rnd_init
	.global g_get_rnd_
	.global g_mem_cpy_
	.global g_malloc_init
	.global g_malloc_
	.global g_free_
	.global g_write_cpu_registers
	.global GL_RND_SEED
	.global GL_ALLOC_ADR
	.global GL_ALLOC_SIZE

GL_RND_TAP	.equ	0xB400
GL_HEAP_HDR	.equ	2

	.area	_CODE		(REL,CON)

; param R1 種（0→1）
g_rnd_init:
	MOV	R1, R1
	JNE	l_rnd_init_ok
	LI	R1, #1
l_rnd_init_ok:
	MOV	R1, GL_RND_SEED
	B	(R11)

; Galois LFSR。return R1
g_get_rnd_:
	MOV	GL_RND_SEED, R1
	MOV	R1, R1
	JNE	l_rnd_go
	LI	R1, #1
l_rnd_go:
	SRL	R1, #1
	JNC	l_rnd_store
	LI	R0, #GL_RND_TAP
	XOR	R1, R0
l_rnd_store:
	MOV	R1, GL_RND_SEED
	B	(R11)

; 平アドレス語コピー。R1=src, R2=dst, R3=語数
g_mem_cpy_:
	MOV	R3, R3
	JEQ	l_mcpy_done
l_mcpy_lp:
	MOV	(R1)+, (R2)+
	AI	R3, #-1
	JNE	l_mcpy_lp
l_mcpy_done:
	B	(R11)

; param R1 先頭、R2 サイズ（語）
g_malloc_init:
	MOV	R1, GL_ALLOC_ADR
	MOV	R2, GL_ALLOC_SIZE
	CI	R2, #GL_HEAP_HDR
	JL	l_minit_done
	MOV	R2, (R1)
	CLR	2(R1)
l_minit_done:
	B	(R11)

; param R1 要求語数（ヘッダ不含）。return R1 ユーザ先頭 or 0
g_malloc_:
	MOV	R11, R8
	MOV	R1, R1
	JEQ	l_m_fail
	AI	R1, #GL_HEAP_HDR
	MOV	GL_ALLOC_ADR, R2
	MOV	GL_ALLOC_SIZE, R4
	CI	R4, #GL_HEAP_HDR
	JL	l_m_fail
l_m_scan:
	MOV	(R2), R3
	MOV	2(R2), R0
	JNE	l_m_next
	C	R3, R1
	JL	l_m_next
	MOV	R3, R0
	S	R1, R0
	CI	R0, #GL_HEAP_HDR
	JL	l_m_take
	MOV	R1, (R2)
	LI	R5, #1
	MOV	R5, 2(R2)
	A	R1, R2
	MOV	R0, (R2)
	CLR	2(R2)
	S	R1, R2
	JMP	l_m_ret_user
l_m_take:
	LI	R5, #1
	MOV	R5, 2(R2)
l_m_ret_user:
	AI	R2, #4
	MOV	R2, R1
	B	(R8)
l_m_next:
	A	R3, R2
	MOV	GL_ALLOC_ADR, R0
	A	R4, R0
	C	R2, R0
	JL	l_m_scan
l_m_fail:
	CLR	R1
	B	(R8)

; param R1 ユーザ先頭。return R1 同 or 0
g_free_:
	MOV	R1, R1
	JEQ	l_free_fail
	AI	R1, #-4
	MOV	2(R1), R0
	CI	R0, #1
	JNE	l_free_fail
	CLR	2(R1)
	AI	R1, #4
	B	(R11)
l_free_fail:
	CLR	R1
	B	(R11)

g_write_cpu_registers:
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_RND_SEED:	.blkw	1
GL_ALLOC_ADR:	.blkw	1
GL_ALLOC_SIZE:	.blkw	1
