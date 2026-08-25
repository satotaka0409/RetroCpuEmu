; TMS9995 コードテスト用: R2 + R3 → R2、R11 へ復帰
	.cpu	tms9995
	.area	_CODE		(REL,CON)
	.org	0x8000
	.global	add
add:
	a	r2,r3
	b	r11
