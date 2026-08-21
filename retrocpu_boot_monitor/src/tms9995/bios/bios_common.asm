; BIOS 共通（乱数・memcpy・malloc）

	.cpu	tms9995
	.include "../memmap.inc"
	.include "../handshake/handshake_io.inc"

	.global g_rnd_init
	.global g_get_rnd_
	.global g_mem_cpy_
	.global g_malloc_init
	.global g_malloc_
	.global g_free_
	.global g_write_cpu_registers
	.global GL_RND_SEED
	.global GL_ALLOC_ADR
	.global GL_ALLOC_SIZE

GL_RND_TAP	.equ	0xB400
GL_HEAP_HDR	.equ	2

	.area	_CODE		(REL,CON)

; 乱数の種を設定する
; @param R2 - 種（0 は M系列がロックするので 1 に補正）
g_rnd_init:
	MOV	R2, R2
	JNE	l_rnd_init_ok
	LI	R2, #1
l_rnd_init_ok:
	MOV	R2, GL_RND_SEED
	B	(R11)

; 16bit M系列（Galois LFSR）で乱数を 1 つ取る
; @return R2 - 乱数値（1〜0xFFFF）
g_get_rnd_:
	MOV	GL_RND_SEED, R2
	MOV	R2, R2
	JNE	l_rnd_go
	LI	R2, #1
l_rnd_go:
	SRL	R2, #1
	JNC	l_rnd_store
	LI	R0, #GL_RND_TAP
	XOR	R0, R2
l_rnd_store:
	MOV	R2, GL_RND_SEED
	B	(R11)

; 平アドレスのワード列をコピーする
; @param R2 - コピー元ワードアドレス
; @param R3 - コピー先ワードアドレス
; @param R4 - 語数（0 なら何もしない）
g_mem_cpy_:
	MOV	R4, R4
	JEQ	l_mcpy_done
l_mcpy_lp:
	MOV	(R2)+, (R3)+
	AI	R4, #-1
	JNE	l_mcpy_lp
l_mcpy_done:
	B	(R11)

; ヒープを初期化する（先頭に空きブロックヘッダを置く）
; @param R2 - 先頭ワードアドレス
; @param R3 - サイズ（語数。ヘッダ 2 語を含む）
g_malloc_init:
	MOV	R2, GL_ALLOC_ADR
	MOV	R3, GL_ALLOC_SIZE
	CI	R3, #GL_HEAP_HDR
	JL	l_minit_done
	MOV	R3, (R2)
	CLR	2(R2)
l_minit_done:
	B	(R11)

; first-fit でヒープを確保する
; @param R2 - 要求語数（ヘッダ不含。0 は失敗）
; @return R2 - ユーザ先頭ワードアドレス。失敗は 0
g_malloc_:
	MOV	R11, R8
	MOV	R2, R2
	JEQ	l_m_fail
	AI	R2, #GL_HEAP_HDR
	MOV	GL_ALLOC_ADR, R5
	MOV	GL_ALLOC_SIZE, R4
	CI	R4, #GL_HEAP_HDR
	JL	l_m_fail
l_m_scan:
	MOV	(R5), R3
	MOV	2(R5), R0
	JNE	l_m_next
	C	R3, R2
	JL	l_m_next
	MOV	R3, R0
	S	R2, R0
	CI	R0, #GL_HEAP_HDR
	JL	l_m_take
	MOV	R2, (R5)
	LI	R1, #1
	MOV	R1, 2(R5)
	A	R2, R5
	MOV	R0, (R5)
	CLR	2(R5)
	S	R2, R5
	JMP	l_m_ret_user
l_m_take:
	LI	R1, #1
	MOV	R1, 2(R5)
l_m_ret_user:
	AI	R5, #4
	MOV	R5, R2
	B	(R8)
l_m_next:
	A	R3, R5
	MOV	GL_ALLOC_ADR, R0
	A	R4, R0
	C	R5, R0
	JL	l_m_scan
l_m_fail:
	CLR	R2
	B	(R8)

; ヒープを解放する（使用中ブロックのみ受け付ける）
; @param R2 - g_malloc_ の戻り値
; @return R2 - 成功時は同じアドレス。失敗は 0
g_free_:
	MOV	R2, R2
	JEQ	l_free_fail
	AI	R2, #-4
	MOV	2(R2), R0
	CI	R0, #1
	JNE	l_free_fail
	CLR	2(R2)
	AI	R2, #4
	B	(R11)
l_free_fail:
	CLR	R2
	B	(R11)

g_write_cpu_registers:
	B	(R11)

	.area	_WORK		(REL,NOLOAD)
GL_RND_SEED:	.blkw	1
GL_ALLOC_ADR:	.blkw	1
GL_ALLOC_SIZE:	.blkw	1
