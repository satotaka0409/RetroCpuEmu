	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_addr_break_set
	.global g_hshk_addr_break_clr
	.global GL_HSHK_ADDR_BREAK

	.area	_CODE		(REL,CON)
g_hshk_addr_break_set:
	LI	R1, #HSHK_OK
	B	(R11)

g_hshk_addr_break_clr:
	LI	R1, #HSHK_OK
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_HSHK_ADDR_BREAK:	.blkw	48
