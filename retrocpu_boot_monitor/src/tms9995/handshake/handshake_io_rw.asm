; IO 読み出し／書き込み（ハンドシェイク 15h / 16h、IO→CPU）
; ヘッダ 5B: pad + addr16 BE + count + pad。読取は 0 埋め＋OK、書込はデータ破棄＋OK。
; @return R2 - OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_io
	.global g_hshk_write_io
	.global g_hshk_recv_byte
	.global g_hshk_send_byte

	.area	_CODE		(REL,CON)
g_hshk_read_io:
	MOV	R11, R8
	BL	l_io_recv_hdr
	CI	R2, #HSHK_OK
	JNE	l_ior_fail
	CI	R4, #HSHK_IO_LIMIT
	JHE	l_ior_ng

l_ior_lp:
	MOV	R4, R4
	JEQ	l_ior_stat
	CLR	R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_ior_fail
	AI	R4, #-1
	JMP	l_ior_lp

l_ior_stat:
	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_ior_fail
	LI	R2, #HSHK_OK
	B	(R8)

l_ior_ng:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
l_ior_fail:
	LI	R2, #HSHK_NG
	B	(R8)

g_hshk_write_io:
	MOV	R11, R8
	BL	l_io_recv_hdr
	CI	R2, #HSHK_OK
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
	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_iow_fail
	LI	R2, #HSHK_OK
	B	(R8)

l_iow_ng:
	LI	R2, #HSHK_NG
	BL	g_hshk_send_byte
l_iow_fail:
	LI	R2, #HSHK_NG
	B	(R8)

; ヘッダ 5B を受ける
; @return R2 - OK/NG
; @return R5 - IO アドレス（16bit）
; @return R4 - バイト数
l_io_recv_hdr:
	DECT	R10
	MOV	R11, (R10)
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R3, #0x00ff
	SOC	R3, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	ANDI	R3, #0x00ff
	MOV	R3, R4
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_io_hdr_fail
	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_io_hdr_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)
