	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_mode_set_

	.area	_CODE		(REL,CON)
g_bios_mode_set_:
	LI	R1, #HSHK_OK
	B	(R11)
