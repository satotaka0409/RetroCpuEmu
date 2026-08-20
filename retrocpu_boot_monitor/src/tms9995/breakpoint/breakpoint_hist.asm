	.cpu	tms9995
	.include "../memmap.inc"

	.global g_bp_hist_append
	.global GL_BP_HIST_META

	.area	_CODE		(REL,CON)
g_bp_hist_append:
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_BP_HIST_META:	.blkw	24
