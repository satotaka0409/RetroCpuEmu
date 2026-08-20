	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_write_memory

	.area	_CODE		(REL,CON)
g_hshk_write_memory:
	LI	R1, #HSHK_NG
	B	(R11)
