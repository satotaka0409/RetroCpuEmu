	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_rtc_get_raw_
	.global g_bios_temp_get_raw_
	.global g_bios_light_get_raw_
	.global g_bios_distance_get_raw_

	.area	_CODE		(REL,CON)
g_bios_rtc_get_raw_:
	CLR	R1
	CLR	R2
	CLR	R3
	CLR	R4
	LI	R1, #HSHK_NG
	B	(R11)

g_bios_temp_get_raw_:
	CLR	R1
	LI	R1, #HSHK_NG
	B	(R11)

g_bios_light_get_raw_:
	CLR	R1
	CLR	R2
	CLR	R3
	CLR	R4
	LI	R1, #HSHK_NG
	B	(R11)

g_bios_distance_get_raw_:
	CLR	R1
	CLR	R2
	LI	R1, #HSHK_NG
	B	(R11)
