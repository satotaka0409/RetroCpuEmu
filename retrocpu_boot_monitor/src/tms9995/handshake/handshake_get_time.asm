	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_get_time_

	.area	_CODE		(REL,CON)
g_hshk_get_time_:
	CLR	R1
	CLR	R2
	CLR	R3
	CLR	R4
	LI	R1, #HSHK_NG
	B	(R11)
