; IO 読み出し／書き込み（ハンドシェイク 15h / 16h、IO→CPU）
; ヘッダ 5B: pad + addr16 BE + count + pad。読取は 0 埋め＋OK、書込はデータ破棄＋OK。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_io
	.global g_hshk_write_io
	.global g_hshk_recv_byte
	.global g_hshk_send_byte

	.area	_CODE		(REL,CON)
g_hshk_read_io:
	MOV	R11, R9
	BL	l_io_recv_hdr
	CI	R1, #HSHK_OK
	JNE	l_ior_fail
	CI	R4, #HSHK_IO_LIMIT
	JHE	l_ior_ng

l_ior_lp:
	MOV	R4, R4
	JEQ	l_ior_stat
	CLR	R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_ior_fail
	AI	R4, #-1
	JMP	l_ior_lp

l_ior_stat:
	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_ior_fail
	LI	R1, #HSHK_OK
	B	(R9)

l_ior_ng:
	LI	R1, #HSHK_NG
	BL	g_hshk_send_byte
l_ior_fail:
	LI	R1, #HSHK_NG
	B	(R9)

g_hshk_write_io:
	MOV	R11, R9
	BL	l_io_recv_hdr
	CI	R1, #HSHK_OK
	JNE	l_iow_fail
	CI	R4, #HSHK_IO_LIMIT
	JHE	l_iow_ng

l_iow_lp:
	MOV	R4, R4
	JEQ	l_iow_stat
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_iow_fail
	AI	R4, #-1
	JMP	l_iow_lp

l_iow_stat:
	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_iow_fail
	LI	R1, #HSHK_OK
	B	(R9)

l_iow_ng:
	LI	R1, #HSHK_NG
	BL	g_hshk_send_byte
l_iow_fail:
	LI	R1, #HSHK_NG
	B	(R9)

; return R1 OK/NG、R3=addr、R4=count
l_io_recv_hdr:
	MOV	R11, R7
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R3
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R1, #0x00ff
	SOC	R1, R3
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R1, #0x00ff
	MOV	R1, R4
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	LI	R1, #HSHK_OK
	B	(R7)

l_io_hdr_fail:
	LI	R1, #HSHK_NG
	B	(R7)
