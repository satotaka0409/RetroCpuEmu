	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_hshk_break_resume
	.global g_step_arm_cpld
	.global g_step_interrupt_handler
	.global GL_BP_STEP_ARM

	.area	_CODE		(REL,CON)
g_hshk_break_resume:
	LI	R1, #HSHK_NG
	B	(R11)

g_step_arm_cpld:
	CLR	R0
	MOV	R0, GL_BP_STEP_ARM
	B	(R11)

g_step_interrupt_handler:
	LI	R1, #HSHK_NG
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_BP_STEP_ARM:	.blkw	1
