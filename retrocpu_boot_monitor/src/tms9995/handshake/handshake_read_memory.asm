	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_memory

	.area	_CODE		(REL,CON)
g_hshk_read_memory:
	LI	R1, #HSHK_NG
	B	(R11)
