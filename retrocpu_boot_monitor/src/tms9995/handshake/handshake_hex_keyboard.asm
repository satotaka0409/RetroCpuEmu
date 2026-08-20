	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_hex_key_get_

	.area	_CODE		(REL,CON)
g_bios_hex_key_get_:
	CLR	R1
	CLR	R2
	CLR	R3
	CLR	R4
	LI	R5, #HSHK_NG
	MOV	R5, R1
	B	(R11)
