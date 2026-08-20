	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_rnd_init
	.global g_get_rnd_
	.global g_mem_cpy_
	.global g_malloc_init
	.global g_malloc_
	.global g_free_
	.global g_malloc2_init
	.global g_malloc2_
	.global g_free2_
	.global g_write_cpu_registers
	.global GL_RND_SEED
	.global GL_ALLOC_ADR
	.global GL_ALLOC_SIZE
	.global GL_ALLOC2_ADR
	.global GL_ALLOC2_SBR
	.global GL_ALLOC2_SIZE

	.area	_CODE		(REL,CON)
g_rnd_init:
	MOV	R1, GL_RND_SEED
	B	(R11)

g_get_rnd_:
	MOV	GL_RND_SEED, R1
	AI	R1, #0xB401
	MOV	R1, GL_RND_SEED
	B	(R11)

g_mem_cpy_:
	LI	R1, #HSHK_OK
	B	(R11)

g_malloc_init:
	MOV	R1, GL_ALLOC_ADR
	MOV	R2, GL_ALLOC_SIZE
	B	(R11)

g_malloc_:
	CLR	R1
	B	(R11)

g_free_:
	CLR	R1
	B	(R11)

g_malloc2_init:
	MOV	R1, GL_ALLOC2_ADR
	MOV	R2, GL_ALLOC2_SBR
	MOV	R3, GL_ALLOC2_SIZE
	B	(R11)

g_malloc2_:
	CLR	R1
	CLR	R2
	B	(R11)

g_free2_:
	CLR	R1
	CLR	R2
	B	(R11)

g_write_cpu_registers:
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_RND_SEED:	.blkw	1
GL_ALLOC_ADR:	.blkw	1
GL_ALLOC_SIZE:	.blkw	1
GL_ALLOC2_ADR:	.blkw	1
GL_ALLOC2_SBR:	.blkw	1
GL_ALLOC2_SIZE:	.blkw	1
