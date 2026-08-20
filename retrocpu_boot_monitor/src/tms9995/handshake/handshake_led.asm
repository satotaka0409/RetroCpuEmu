	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_bios_led_display_
	.global g_bios_led_seven_seg
	.global g_bios_led_bullet
	.global GL_HSHK_LED_LATCH

	.area	_CODE		(REL,CON)
g_bios_led_display_:
	LI	R1, #HSHK_NG
	B	(R11)

g_bios_led_seven_seg:
	LI	R1, #HSHK_NG
	B	(R11)

g_bios_led_bullet:
	LI	R1, #HSHK_NG
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_HSHK_LED_LATCH:	.blkw	14
