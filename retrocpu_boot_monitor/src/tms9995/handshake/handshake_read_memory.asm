; メモリ読み出し（ハンドシェイク 13h、IO→CPU）
; コマンド済み。ヘッダ 9B: pad + addr32 BE + count32 BE。
; count バイトを mem_ld8 で送ったあと status 1B を受信。
; 下位 16bit の addr/count のみ使用（小転送向け）。
; @return R2 - OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_ld8

	.area	_CODE		(REL,CON)
g_hshk_read_memory:
	MOV	R11, R8

	; pad
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	; addr hi word（破棄）
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	; addr lo
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R3, #0x00ff
	SOC	R3, R5

	; count hi（破棄）
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	; count lo
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R4
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R3, #0x00ff
	SOC	R3, R4

l_rm_lp:
	MOV	R4, R4
	JEQ	l_rm_stat
	MOV	R5, R2
	BL	g_hshk_mem_ld8
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	MOV	R3, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	AI	R5, #1
	AI	R4, #-1
	JMP	l_rm_lp

l_rm_stat:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R3, #0x00ff
	CI	R3, #HSHK_OK
	JNE	l_rm_fail
	LI	R2, #HSHK_OK
	B	(R8)

l_rm_fail:
	LI	R2, #HSHK_NG
	B	(R8)
