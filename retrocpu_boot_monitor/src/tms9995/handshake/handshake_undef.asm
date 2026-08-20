	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_undef_led

	.area	_CODE		(REL,CON)
g_bios_undef_led:
	LI	R1, #HSHK_NG
	B	(R11)
