	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_pc_key_get_

	.area	_CODE		(REL,CON)
g_bios_pc_key_get_:
	CLR	R1
	CLR	R2
	LI	R1, #HSHK_NG
	B	(R11)
