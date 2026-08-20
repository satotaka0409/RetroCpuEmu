	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_break_hist_get

	.area	_CODE		(REL,CON)
g_hshk_break_hist_get:
	LI	R1, #HSHK_NG
	B	(R11)
