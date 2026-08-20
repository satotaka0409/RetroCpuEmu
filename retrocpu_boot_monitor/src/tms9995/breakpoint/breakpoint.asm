	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_breakpoint_interrupt_handler

	.area	_CODE		(REL,CON)
g_breakpoint_interrupt_handler:
	LI	R1, #HSHK_NG
	B	(R11)
