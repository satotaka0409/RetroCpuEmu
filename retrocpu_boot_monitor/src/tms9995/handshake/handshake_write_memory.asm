; メモリ書き込み（ハンドシェイク 14h、IO→CPU）
; コマンド済み。ヘッダ 9B + count バイト受信 → mem_st8 → status 1B 送信。
; 下位 16bit の addr/count のみ使用（小転送向け）。

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_write_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_st8

	.area	_CODE		(REL,CON)
g_hshk_write_memory:
	MOV	R11, R9

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R6
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R1, #0x00ff
	SOC	R1, R6
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail

l_wm_lp:
	MOV	R6, R6
	JEQ	l_wm_stat
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R1, #0x00ff
	MOV	R1, R2			; 書込データ
	MOV	R5, R1			; バイトアドレス
	BL	g_hshk_mem_st8
	CI	R1, #HSHK_OK
	JNE	l_wm_fail
	AI	R5, #1
	AI	R6, #-1
	JMP	l_wm_lp

l_wm_stat:
	LI	R1, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_wm_fail
	LI	R1, #HSHK_OK
	B	(R9)

l_wm_fail:
	LI	R1, #HSHK_NG
	B	(R9)
