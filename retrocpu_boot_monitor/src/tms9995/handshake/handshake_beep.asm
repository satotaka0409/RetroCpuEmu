	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_beep_

	.area	_CODE		(REL,CON)
g_bios_beep_:
	LI	R1, #HSHK_NG
	B	(R11)
