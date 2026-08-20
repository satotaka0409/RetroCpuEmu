	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_io
	.global g_hshk_write_io

	.area	_CODE		(REL,CON)
g_hshk_read_io:
	LI	R1, #HSHK_NG
	B	(R11)

g_hshk_write_io:
	LI	R1, #HSHK_NG
	B	(R11)
