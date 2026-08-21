; メモリ書き込み（ハンドシェイク 14h、IO→CPU）
; コマンド済み。ヘッダ 9B + count バイト受信 → mem_st8 → status 1B 送信。
; 下位 16bit の addr/count のみ使用（小転送向け）。
; @return R2 - OK/NG

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

	.global g_hshk_write_memory
	.global g_hshk_recv_byte
	.global g_hshk_send_byte
	.global g_hshk_mem_st8

	.area	_CODE		(REL,CON)
g_hshk_write_memory:
	MOV	R11, R8

	; pad
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail

	; addr hi（破棄）
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail

	; addr lo
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R3, #0x00ff
	SOC	R3, R5

	; count hi（破棄）
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail

	; count lo
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R4
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R3, #0x00ff
	SOC	R3, R4

l_wm_lp:
	MOV	R4, R4
	JEQ	l_wm_stat
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	ANDI	R3, #0x00ff		; 書込データ
	MOV	R5, R2			; バイトアドレス
	BL	g_hshk_mem_st8
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	AI	R5, #1
	AI	R4, #-1
	JMP	l_wm_lp

l_wm_stat:
	LI	R2, #HSHK_OK
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_wm_fail
	LI	R2, #HSHK_OK
	B	(R8)

l_wm_fail:
	LI	R2, #HSHK_NG
	B	(R8)
