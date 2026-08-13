; breakpoint.asm
; CPLD 比較器ヒット（INT2 / INT_CAUSE=4）の処理
;
; 根拠:
;   HandShake.mdc（18h ブレイク通知 / 40h スロット表）
;   MN1613_CPUボードメモリ_IOマップ.mdc（IO 0033 ヒット番号、0034 前回書込値）
;   breakpoint.mdc / retrocpu_debug.mdc
;
; 呼び出し:
;   g_int2_handler が INT_CAUSE=4 のとき BALD する。
;   戻り R0=0 → INT2 は LPSW 2 でユーザへ戻る（スルー）。
;   戻り R0=1 → INT2 はスタックをほどいて g_main_loop へ（モニタ HALT）。
;
; 処理の流れ:
;   1. 0033 を読む。Bit3 以上が立っていたら未ヒット（0xFFFF など）→ スルー。
;      下位 3bit がスロット番号 0–7。
;   2. 0034 を読む（前回書込値）。GL_BP_HIT_PREV に生値を残す。
;   3. スロット 6–7 はステップ専用 → 区分 3 で 18h → HALT（履歴なし）。
;   4. スロット 0–5 は GL_HSHK_ADDR_BREAK（1 スロット 6 ワード）を見る。
;        +0 ena    0=無効 → スルー
;        +1 flags  Bit0=IO Bit1=RD Bit2=WR Bit3–5=条件 Bit6=INST Bit7=履歴
;        +2 count  0=このヒットで停止。1–255=残り回数（1 減らし、0 になったら停止）
;        +3 addrH  監視アドレス 32bit の上位（バイト、ビッグエンディアン）
;        +4 addrL  下位
;        +5 data   値比較の相手（MEM かつ条件≠0 のときだけ使う）
;   5. 区分: INST(Bit6) → 0 / IO(Bit0) → 2 / それ以外 → MEM(1)
;   6. 値比較は MEM かつ条件≠0 のみ。IO・命令は条件を無視。
;      不一致・条件不正 → スルー（履歴にも書かない）。
;   7. Bit7 履歴かつ一致なら 16h で時刻を取り、3F000h（SBR C）へ 1 件追記。
;      エントリ 17 ワード（60h）: 時刻4 + AFTER + PREV + 48h レジスタ 11。
;      WRITE 以外／命令は PREV=0000h。IO の AFTER は 0。リング 16、メタは _WORK。
;   8. 停止するとき 18h を CPU→IO で送り、OK/NG 1B を IO→CPU で受ける。
;
; 18h 線上（送信 7B → 受信 1B status）:
;   18h, 区分(0=命令/1=MEM/2=IO/3=ステップ), スロット 0–7, addr32 BE
;   ステップ 6–7 は表が無いので addr は 0。
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
;   R3=スロット、R2=18h 区分、X1(R4)=表ポインタ（ステップ時は 0）
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
	.global g_hshk_get_time
	.global GL_BP_HIT_PREV
	.global GL_BP_HIST_META

; 18h 区分（HandShake.mdc）
BP_KIND_INST		.equ	0
BP_KIND_MEM		.equ	1
BP_KIND_IO		.equ	2
BP_KIND_STEP		.equ	3

; 値比較（flags Bit3–5 を 3 回論理右シフトした値）
BP_COND_EQ		.equ	1	; =
BP_COND_NE		.equ	2	; <>
BP_COND_GE		.equ	3	; >=（符号付き）
BP_COND_LE		.equ	4	; <=（符号付き）
BP_COND_AND_NZ		.equ	5	; (access AND data) <> 0
BP_COND_AND_Z		.equ	6	; (access AND data) = 0
; 0=条件なし（比較しない）、7=未定義 → スルー

; -------------------------------------------------------
; アドレスブレイク（INT_CAUSE=4）
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

	; スロット < 6 → ユーザ表。>= 6 → ステップ
	cwi	R3, #HSHK_AB_SLOTS, M
	b	l_bp_step
	b	l_bp_user
l_bp_step:
	mvi	R2, #BP_KIND_STEP
	eor	R4, R4			; 表なし（addr は 0 で送る）
	bd	l_bp_notify

; --- ユーザ 0–5: 表を見て比較・回数 ---
l_bp_user:
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
	bald	l_bp_hist_append
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

; --- 18h ブレイク通知。失敗しても HALT（R0=1）---
; 入口: R2=区分、R3=スロット、X1=表（ステップは 0）
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
	cwi	R3, #HSHK_AB_SLOTS, M
	b	l_bp_send_zero_addr
	b	l_bp_send_tbl_addr
l_bp_send_zero_addr:
	eor	R0, R0			; ステップ: addr32 = 0
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_nt_addr2
	bd	l_bp_notify_fail
l_bp_nt_addr2:
	eor	R0, R0
	bald	g_hshk_send_word
	cwi	R0, #HSHK_OK, NZ
	b	l_bp_send_fin
	bd	l_bp_notify_fail
l_bp_send_tbl_addr:
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

; -------------------------------------------------------
; Bit7 履歴 1 件を 3F000h へ追記（60h エントリ）。
; 入口: R2=区分、R3=スロット、X1=表。比較一致済み。
; 16h の応答待ち前に BUSY を下ろす。失敗しても時刻 0 で書く。
; @Destruction R0, R1（R2 / R3 / X1 は保存）
; -------------------------------------------------------
l_bp_hist_append:
	push	R2
	push	R3
	push	X1

	; AFTER: MEM/命令は監視アドレスの現在値。IO は 0
	cwi	R2, #BP_KIND_IO, Z
	b	l_bp_ha_mem
	b	l_bp_ha_io
l_bp_ha_mem:
	l	R0, 3(X1)
	l	R1, 4(X1)
	bald	g_hshk_mem_map
	lr	R0, TSR0, (R1)
	b	l_bp_ha_after
l_bp_ha_io:
	eor	R0, R0
l_bp_ha_after:
	mvwi	X0, #GL_BP_HIT_DATA
	st	R0, 0(X0)

	; PREV: 命令、または WR でない → 0000h。WR なら 0034 生値
	mv	X0, SP
	l	X1, 1(X0)		; 表（X0≡R3 になる）
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_INST, NZ
	b	l_bp_ha_prev_wr
	eor	R1, R1
	b	l_bp_ha_prev_st
l_bp_ha_prev_wr:
	l	R0, 1(X1)
	andi	R0, #HSHK_AB_F_WR, NZ
	b	l_bp_ha_prev_z
	mvwi	X0, #GL_BP_HIT_PREV
	l	R1, 0(X0)
	b	l_bp_ha_prev_st
l_bp_ha_prev_z:
	eor	R1, R1
l_bp_ha_prev_st:
	mvwi	X0, #GL_BP_HIT_PREV_W
	st	R1, 0(X0)

	; 16h。INT2 中は BUSY=1 のままでは IO が応答しない
	eor	R0, R0
	wt	R0, INTERRUPT_BUSY
	si	SP, #4
	mv	X0, SP
	eor	R0, R0
	st	R0, 1(X0)
	st	R0, 2(X0)
	st	R0, 3(X0)
	st	R0, 4(X0)
	bald	g_hshk_get_time

	; スロット → メタ。dest = F000h + slot*272 + head*17
	mv	X0, SP
	l	R3, 6(X0)		; スロット（時刻 4 + 表の下）
	mv	R0, R3
	sl	R0, RE
	a	R0, R3			; *3
	mvwi	R1, #GL_BP_HIST_META
	a	R0, R1
	mvwi	X1, #GL_BP_HIST_MPTR
	st	R0, 0(X1)
	mv	X1, R0			; メタ
	l	R0, 1(X1)		; head
	mv	R1, R0
	sl	R0, RE
	sl	R0, RE
	sl	R0, RE
	sl	R0, RE			; head*16
	a	R0, R1			; head*17
	mv	R1, R3
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; slot*16
	mv	R2, R1
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE
	sl	R1, RE			; slot*256
	a	R1, R2			; slot*272
	a	R1, R0
	mvwi	R0, #HSHK_BH_BASE
	a	R1, R0			; 論理 dest
	mv	X1, R1
	mvi	R0, #HSHK_BH_SBR
	setb	R0, TSR0

	; 時刻 4 ワード
	mv	X0, SP
	ai	X0, #1
	mvi	R2, #4
l_bp_ha_ct:
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X0, #1
	ai	X1, #1
	si	R2, #1, Z
	b	l_bp_ha_ct
	mvwi	X0, #GL_BP_HIT_DATA
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, 1(X0)		; GL_BP_HIT_PREV_W（隣接）
	str	R0, TSR0, (R4)
	ai	X1, #1

	; 48h レジスタ 11 ワード（R0–R2 は 0。R3/R4 は入口スナップ）
	eor	R0, R0
	str	R0, TSR0, (R4)
	ai	X1, #1
	str	R0, TSR0, (R4)
	ai	X1, #1
	str	R0, TSR0, (R4)
	ai	X1, #1
	mvwi	X0, #GL_BP_SNAP_R3
	l	R0, 0(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, 1(X0)
	str	R0, TSR0, (R4)
	ai	X1, #1
	eor	R0, R0			; SP（call 経路では再構成しない）
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *HSHK_L2_STR_SAVE
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, *HSHK_L2_IC_SAVE
	str	R0, TSR0, (R4)
	ai	X1, #1
	cpyb	R0, OSR0
	andi	R0, #0x000f
	bswp	R0, R0
	cpyb	R1, SSBR
	andi	R1, #0x000f
	or	R0, R1
	str	R0, TSR0, (R4)
	ai	X1, #1
	l	R0, 2(X0)		; SNAP TSR0。X0 はまだ SNAP_R3
	bswp	R0, R0
	l	R1, 3(X0)
	or	R0, R1
	str	R0, TSR0, (R4)
	ai	X1, #1
	cpys	R0, NPP
	andi	R0, #0xff00
	cpyh	R1, IISR
	andi	R1, #0x8000
	bswp	R1, R1
	or	R0, R1
	str	R0, TSR0, (R4)

	; メタ更新。_WORK は CSBR（TSR0 は C のまま触らない）
	mvwi	X0, #GL_BP_HIST_MPTR
	l	X1, 0(X0)
	l	R0, 1(X1)
	ai	R0, #1
	andi	R0, #0x000f
	st	R0, 1(X1)
	l	R0, 0(X1)
	cwi	R0, #HSHK_BH_DEPTH, M
	b	l_bp_ha_full
	ai	R0, #1
	st	R0, 0(X1)
	b	l_bp_ha_meta_ok
l_bp_ha_full:
	mvi	R0, #1
	st	R0, 2(X1)
l_bp_ha_meta_ok:
	ai	SP, #4
	mvwi	X0, #GL_BP_SNAP_TSR0
	l	R0, 0(X0)
	setb	R0, TSR0
	pop	X1
	pop	R3
	pop	R2
	ret

	.area	_WORK		(REL,NOLOAD)
; 0034 生値（READ ヒットでも CPLD が出した値）
GL_BP_HIT_PREV:		.ds	1
; 履歴に書く AFTER / フィルタ後 PREV
GL_BP_HIT_DATA:		.ds	1
GL_BP_HIT_PREV_W:	.ds	1
; 入口スナップ（R3 / R4 / TSR0 / TSR1）
GL_BP_SNAP_R3:		.ds	1
GL_BP_SNAP_R4:		.ds	1
GL_BP_SNAP_TSR0:	.ds	1
GL_BP_SNAP_TSR1:	.ds	1
; 追記中のメタ先頭
GL_BP_HIST_MPTR:	.ds	1
; スロット 0–5: 件数 / 次書込 index / オーバフロー
GL_BP_HIST_META:	.ds	HSHK_BH_META_TBL
