	.cpu	tms9995
	.include "memmap.inc"
	.include "interrupt_io.inc"

	.global g_set_int_adr
	.global g_int0_handler
	.global g_int1_handler
	.global g_int2_handler
	.global g_int3_handler
	.global GL_INT0_ADR
	.global GL_INT1_ADR
	.global GL_INT2_ADR
	.global GL_INT3_ADR
	.global GL_UNDEF_INST_REG

	.global g_handshake_interrupt_handler
	.global g_breakpoint_interrupt_handler
	.global g_step_interrupt_handler
	.global g_step_arm_cpld

	.area	_CODE		(REL,CON)
g_set_int_adr:
	B	(R11)

g_int0_handler:
	RTWP

g_int1_handler:
	BL	g_breakpoint_interrupt_handler
	RTWP

g_int2_handler:
	BL	g_handshake_interrupt_handler
	BL	g_step_arm_cpld
	RTWP

g_int3_handler:
	BL	g_step_interrupt_handler
	RTWP

	.area	_WORK		(REL,NOLOAD)
GL_INT0_ADR:	.blkw	1
GL_INT1_ADR:	.blkw	1
GL_INT2_ADR:	.blkw	1
GL_INT3_ADR:	.blkw	1
GL_UNDEF_INST_REG:	.blkw	16
