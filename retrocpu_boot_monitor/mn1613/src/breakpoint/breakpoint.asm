; breakpoint.asm
; CPLD 比較器ヒット（INT2 / INT_CAUSE=3）の処理
;
; 根拠:
;   HandShake.mdc（1Ah ブレイク通知 / 10h スロット表）
;   MN1613_CPUボードメモリ_IOマップ.mdc（IO 0033 ヒット番号、0034 前回書込値）
;   breakpoint.mdc / retrocpu_debug.mdc
;
; 呼び出し:
;   g_int2_handler が INT_CAUSE=3 のとき BALD する。
;   戻り R0=0 → INT2 は LPSW 2 でユーザへ戻る（スルー）。
;   戻り R0=1 → INT2 はスタックをほどいて g_main_loop へ（モニタ HALT）。
;
; 処理の流れ:
;   1. 0033 を読む。Bit3 以上が立っていたら未ヒット（0xFFFF など）→ スルー。
;      下位 3bit がスロット番号 0–7。
;   2. 0034 を読む（前回書込値）。GL_BP_HIT_PREV に生値を残す。
;   3. スロット 0–7 はすべてユーザ。GL_HSHK_ADDR_BREAK（1 スロット 6 ワード）を見る。
;      ステップ実行は比較器を使わない（別機構）。
;        +0 ena    0=無効 → スルー
;        +1 flags  Bit0=IO Bit1=RD Bit2=WR Bit3–5=条件 Bit6=INST Bit7=履歴
;        +2 count  0=このヒットで停止。1–255=残り回数（1 減らし、0 になったら停止）
;        +3 addrH  監視アドレス 32bit の上位（バイト、ビッグエンディアン）
;        +4 addrL  下位
;        +5 data   値比較の相手（MEM かつ条件≠0 のときだけ使う）
;   4. 区分: INST(Bit6) → 0 / IO(Bit0) → 2 / それ以外 → MEM(1)
;   5. 値比較は MEM かつ条件≠0 のみ。IO・命令は条件を無視。
;      不一致・条件不正 → スルー（履歴にも書かない）。
;   6. Bit7 履歴かつ一致なら 11h で時刻を取り、3F000h（SBR C）へ 1 件追記。
;      エントリ 33 ワード（17h）: 時刻4 + AFTER + PREV + レジスタ 11 + スタック 16。
;      WRITE 以外／命令は PREV=0000h。IO の AFTER は 0。リング 16、メタは _WORK。
;   7. 停止するとき 1Ah を CPU→IO で送り、OK/NG 1B を IO→CPU で受ける。
;
; 1Ah 線上（送信 7B → 受信 1B status）:
;   1Ah, 区分(0=命令/1=MEM/2=IO), スロット 0–7, addr32 BE
;   ステップ通知は 1Bh（このハンドラでは出さない）。
;   応答は IO→CPU なので、待ちの前に INTERRUPT_BUSY を 0 にする。
;   BUSY=1 のままだと IO が応答を保留し、互いに待ち合う。
;
; 分岐の約束（MN1613）:
;   スキップ（,Z / ,NZ / ,M など）は「次の 1 語だけ」飛ばす。
;   `bd` は 2 語なのでスキップの直後に置かない。
;   遠い先へ行くときは「1 語の `b` で近くへ」か「スキップしない `bd`」。
;
; Bit7 履歴は回数判定の前に書く。回数そのものは変えない。
;
; レジスタ（ハンドラ内）:
;   R3=スロット、R2=1Ah 区分、X1(R4)=表ポインタ
;   R0–R2 は破壊可。R3–R4 は入口で PUSH、出口で POP。

	.cpu	mn1613

	.include "../handshake/handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_breakpoint_interrupt_handler
	.global GL_HSHK_ADDR_BREAK
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_send_word
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv
	.global g_hshk_mem_map
	.global g_bp_hist_append
	.global GL_BP_HIT_PREV
	.global GL_BP_SNAP_R3
	.global GL_BP_SNAP_TSR0
	.global GL_BP_SNAP_SP

; 1Ah 区分（HandShake.mdc）
BP_KIND_INST		.equ	0
BP_KIND_MEM		.equ	1
BP_KIND_IO		.equ	2
; 区分 3（ステップ）は比較器ヒットでは出さない

; 値比較（flags Bit3–5 を 3 回論理右シフトした値）
BP_COND_EQ		.equ	1	; =
BP_COND_NE		.equ	2	; <>
BP_COND_GE		.equ	3	; >=（符号付き）
BP_COND_LE		.equ	4	; <=（符号付き）
BP_COND_AND_NZ		.equ	5	; (access AND data) <> 0
BP_COND_AND_Z		.equ	6	; (access AND data) = 0
; 0=条件なし（比較しない）、7=未定義 → スルー

; -------------------------------------------------------
; アドレスブレイク（INT_CAUSE=3）
; @return R0 - 0=継続（LPSW 2） / 1=モニタ HALT（g_main_loop）
; @Destruction R0, R1, R2（R3–R4 は退避。値比較時は TSR0 を一時変更）
; -------------------------------------------------------
g_breakpoint_interrupt_handler:
	push	R3
	push	R4
	; 履歴用にヒット直前の R3/R4/TSR を残す。
	; X0≡R3 / X1≡R4 なので、mvwi の前にスタックから取る。
	mv	X0, SP
	l	R1, 2(X0)		; 元 R3
	l	R2, 1(X0)		; 元 R4
	mvwi	X1, #GL_BP_SNAP_R3
	st	R1, 0(X1)
	st	R2, 1(X1)
	cpyb	R0, TSR0
	andi	R0, #0x000f
	st	R0, 2(X1)
	cpyb	R0, TSR1
	andi	R0, #0x000f
	st	R0, 3(X1)
	; ヒット直前のユーザ SP（INT2: PSHM 5 + TSR 2 + 穴 1 + X1 + 戻り + R3/R4）
	mv	R0, SP
	ai	R0, #12
	st	R0, 4(X1)

	; --- ヒット番号（0033）。0xFFFF をスロット 7 と誤認しない ---
	rd	R0, IO_BREAK_HIT
	mv	R1, R0
	andi	R1, #0xfff8, NZ		; Bit3 以上が 1 → 無効
	b	l_bp_hit_ok
	bd	l_bp_cont
l_bp_hit_ok:
	andi	R0, #0x0007
	mv	R3, R0			; R3 = スロット 0–7
	rd	R1, IO_BREAK_PREV	; 0034 前回書込値
	mvwi	X1, #GL_BP_HIT_PREV	; X1≡R4。スロットは R3 のまま
	st	R1, 0(X1)

; --- ユーザ 0–7: 表を見て比較・回数 ---
	; X1 = GL_HSHK_ADDR_BREAK + slot * 6
	mv	R0, R3
	sl	R0, RE			; *2
	mv	R2, R0
	sl	R0, RE			; *4
	a	R2, R0			; *6
	mvwi	X1, #GL_HSHK_ADDR_BREAK
	a	X1, R2
	l	R0, 0(X1)		; ena
	or	R0, R0, Z
	b	l_bp_ena_ok
	bd	l_bp_cont		; 無効スロット → スルー
l_bp_ena_ok:
	l	R0, 1(X1)		; flags（以降 R0 に保持）
	mv	R1, R0
	andi	R1, #HSHK_AB_F_INST, NZ
	b	l_bp_chk_io
	mvi	R2, #BP_KIND_INST
	b	l_bp_have_kind
l_bp_chk_io:
	mv	R1, R0
	andi	R1, #HSHK_AB_F_IO, NZ
	b	l_bp_kind_mem
	mvi	R2, #BP_KIND_IO
	b	l_bp_have_kind
l_bp_kind_mem:
	mvi	R2, #BP_KIND_MEM
l_bp_have_kind:
	; 値比較は MEM だけ。IO／命令は回数判定へ
	cwi	R2, #BP_KIND_MEM, NZ
	b	l_bp_maybe_cmp
	bd	l_bp_count
l_bp_maybe_cmp:
	mv	R1, R0
	andi	R1, #HSHK_AB_F_COND, Z	; Bit3–5 が 0 → 比較しない
	b	l_bp_do_cmp
	bd	l_bp_count
l_bp_do_cmp:
	sr	R0, RE
	sr	R0, RE
	sr	R0, RE
	andi	R0, #7			; 条件 0–7
	or	R0, R0, Z
	b	l_bp_cmp_ready
	bd	l_bp_count

	; 比較用に cond / kind / slot / 表 を積む（mem_map が R0–R2・TSR0 を壊す）
	; スタック（上から）: 表, slot, kind, cond
l_bp_cmp_ready:
	push	R0
	push	R2
	push	R3
	push	X1
	l	R0, 3(X1)		; 監視バイトアドレス 32bit
	l	R1, 4(X1)
	bald	g_hshk_mem_map		; R1=論理ワード、TSR0=SBR
	lr	R0, TSR0, (R1)		; アクセス後のメモリ値（16bit）
	pop	X1
	l	R1, 5(X1)		; 比較データ
	mv	R2, R0			; R2=実値、R1=期待
	mv	X0, SP
	l	R0, 3(X0)		; cond（X0=SP のまま。R3 はまだ slot のコピーではない）
	cwi	R0, #BP_COND_EQ, NZ
	b	l_bp_eq
	cwi	R0, #BP_COND_NE, NZ
	b	l_bp_ne
	cwi	R0, #BP_COND_GE, NZ
	b	l_bp_ge
	cwi	R0, #BP_COND_LE, NZ
	b	l_bp_le
	cwi	R0, #BP_COND_AND_NZ, NZ
	b	l_bp_andnz
	cwi	R0, #BP_COND_AND_Z, NZ
	b	l_bp_andz
	bd	l_bp_cmp_fail		; 条件 7 など
l_bp_eq:
	c	R2, R1, Z
	b	l_bp_cmp_fail
	b	l_bp_cmp_ok
l_bp_ne:
	c	R2, R1, NZ
	b	l_bp_cmp_fail
	b	l_bp_cmp_ok
l_bp_ge:
	c	R2, R1, PZ		; 実値 - 期待 >= 0
	b	l_bp_cmp_fail
	b	l_bp_cmp_ok
l_bp_le:
	c	R1, R2, PZ		; 期待 - 実値 >= 0 → 実値 <= 期待
	b	l_bp_cmp_fail
	b	l_bp_cmp_ok
l_bp_andnz:
	and	R2, R1
	or	R2, R2, NZ
	b	l_bp_cmp_fail
	b	l_bp_cmp_ok
l_bp_andz:
	and	R2, R1
	or	R2, R2, Z
	b	l_bp_cmp_fail
l_bp_cmp_ok:
	pop	R3			; slot
	pop	R2			; kind
	ai	SP, #1			; cond を捨てる。X1 は表のまま
	b	l_bp_count
l_bp_cmp_fail:
	ai	SP, #3			; slot / kind / cond
	bd	l_bp_cont

	; Bit7 なら先に履歴。そのあと count=0 → 即停止。それ以外は 1 減らし…
l_bp_count:
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_HIST, NZ
	b	l_bp_count_body
	bald	g_bp_hist_append
l_bp_count_body:
	l	R0, 2(X1)
	or	R0, R0, Z
	b	l_bp_count_nz
	bd	l_bp_notify
l_bp_count_nz:
	si	R0, #1
	st	R0, 2(X1)
	or	R0, R0, Z
	b	l_bp_count_left
	bd	l_bp_notify
l_bp_count_left:
	bd	l_bp_cont

; --- 1Ah ブレイク通知。失敗しても HALT（R0=1）---
; 入口: R2=区分、R3=スロット、X1=表
; 積む順: kind → slot → 表。SP+1=表、SP+2=slot、SP+3=kind
; X0≡R3 なので、表を読むときは先に R4 へ取り、あとで R3 に slot を入れる
l_bp_notify:
	push	R2
	push	R3
	push	X1
	bald	g_hshk_initiate_send
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_cmd
	bd	l_bp_notify_fail
l_bp_nt_cmd:
	mvwi	R0, #HSHK_CMD_BREAK_NOTIFY
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_kind
	bd	l_bp_notify_fail
l_bp_nt_kind:
	mv	X0, SP
	l	R0, 3(X0)		; 区分
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_slot
	bd	l_bp_notify_fail
l_bp_nt_slot:
	mv	X0, SP
	l	R0, 2(X0)		; スロット
	andi	R0, #0x00ff
	bald	g_hshk_send_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_addr
	bd	l_bp_notify_fail
l_bp_nt_addr:
	mv	X0, SP
	l	R4, 1(X0)		; 表（X0=SP のあいだに読む）
	l	R3, 2(X0)		; スロット
	l	R0, 3(X1)		; addr 上位 16bit
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_tbl2
	bd	l_bp_notify_fail
l_bp_nt_tbl2:
	l	R0, 4(X1)		; addr 下位 16bit
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_send_fin
	bd	l_bp_notify_fail
l_bp_send_fin:
	bald	g_hshk_finalize_send
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_wait
	bd	l_bp_notify_fail
	; IO→CPU の status を受ける。BUSY=1 だと IO が送らない
l_bp_nt_wait:
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	bald	g_hshk_wait_req1_1
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_accept
	bd	l_bp_notify_fail
l_bp_nt_accept:
	bald	g_hshk_accept_request
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_recv
	bd	l_bp_notify_fail
l_bp_nt_recv:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_fin
	bd	l_bp_notify_recv_fail
l_bp_nt_fin:
	bald	g_hshk_finalize_recv
	bd	l_bp_notify_done
l_bp_notify_recv_fail:
	bald	g_hshk_finalize_recv
l_bp_notify_fail:
l_bp_notify_done:
	ai	SP, #3			; kind / slot / 表
	mvi	R0, #1			; HALT
	pop	R4
	pop	R3
	ret

l_bp_cont:
	eor	R0, R0			; 継続
	pop	R4
	pop	R3
	ret

	.area	_WORK		(REL,NOLOAD)
; 0034 生値（READ ヒットでも CPLD が出した値）
GL_BP_HIT_PREV:		.ds	1
; 入口スナップ（R3 / R4 / TSR0 / TSR1）。履歴追記が読む
GL_BP_SNAP_R3:		.ds	1
GL_BP_SNAP_R4:		.ds	1
GL_BP_SNAP_TSR0:	.ds	1
GL_BP_SNAP_TSR1:	.ds	1
GL_BP_SNAP_SP:		.ds	1

