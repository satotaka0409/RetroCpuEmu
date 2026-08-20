; メモリ読み出し（ハンドシェイク 13h、IO→CPU）
; コマンド済み。ヘッダ 9B: addr32 BE + count32 BE + pad。
; count バイトを mem_ld8 で送ったあと status 1B を受信。
; 下位 16bit の addr/count のみ使用（小転送向け）。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_read_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_ld8

	.area	_CODE		(REL,CON)
g_hshk_read_memory:
	MOV	R11, R9

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
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5

	; count hi（破棄）
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
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R6
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R1, #0x00ff
	SOC	R1, R6
	; pad
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail

l_rm_lp:
	MOV	R6, R6
	JEQ	l_rm_stat
	MOV	R5, R1
	BL	g_hshk_mem_ld8
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_rm_fail
	AI	R5, #1
	AI	R6, #-1
	JMP	l_rm_lp

l_rm_stat:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rm_fail
	ANDI	R1, #0x00ff
	CI	R1, #HSHK_OK
	JNE	l_rm_fail
	LI	R1, #HSHK_OK
	B	(R9)

l_rm_fail:
	LI	R1, #HSHK_NG
	B	(R9)
