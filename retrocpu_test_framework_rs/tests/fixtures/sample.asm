	.cpu	mn1613
	.area	_CODE (REL,CON)
	.org	0x0200
	.globl	GL_MAIN
	.globl	GL_SUM_1_TO_10
GL_MAIN:
	h

GL_SUM_1_TO_10:
	eor	R0, R0
	mvwi	R1, #10
L_SUM_LOOP:
; @cp sum_iter_enter
	a	R0, R1
; @cp sum_iter_leave
	si	R1, #1, Z
	b	L_SUM_LOOP
	ret
