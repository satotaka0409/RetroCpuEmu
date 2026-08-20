; handshake_sensor_raw.asm
; センサー生値取得（ハンドシェイク 1Ch-1Fh）
; 根拠: HandShake.mdc「センサー系コマンド」/ boot_monitor.mdc
;
; 1Ch RTC生値:        送信 1B / 受信 8B (regs7 + status)
; 1Dh 温度生値:       送信 1B / 受信 3B (raw16 + status)
; 1Eh 光センサー生値: 送信 1B / 受信 9B (C,R,G,B 各16bit + status)
; 1Fh 距離センサー生値:送信 1B / 受信 4B (distance16 + rangeStatus + status)
;
; いずれも REQ_1 ポーリングで IO→CPU 応答を受ける。
; R3-R4 は非破壊。失敗時は status=02h（その他エラー）を返す。

	.cpu	mn1613

	.include "handshake_io.inc"

	.area	_CODE		(REL,CON)

	.global g_bios_rtc_get_raw_
	.global g_bios_temp_get_raw_
	.global g_bios_light_get_raw_
	.global g_bios_distance_get_raw_
	.global g_hshk_initiate_send
	.global g_hshk_send_byte
	.global g_hshk_finalize_send
	.global g_hshk_wait_req1_1
	.global g_hshk_accept_request
	.global g_hshk_recv_byte
	.global g_hshk_finalize_recv

HSHK_RTC_RAW_BYTES	.equ	7
HSHK_LIGHT_RAW_WORDS	.equ	4

; -------------------------------------------------------
; 1Ch RTC生値取得
; @param R0 - 結果バッファ先頭（ワードアドレス。7 ワード、各下位 8bit）
; @return R0 - OK / NG_OTHER
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_rtc_get_raw_:
	push	R3
	push	R4
	mv	R2, R0

	mvwi	R0, #HSHK_CMD_RTC_GET_RAW
	bald	l_sensor_begin
	cwi	R0, #HSHK_OK, Z
	b	l_rtc_fail

	mvwi	X1, #HSHK_RTC_RAW_BYTES
l_rtc_recv_lp:
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_rtc_recv_fail
	andi	R1, #0x00ff
	mv	X0, R2
	st	R1, 0(X0)
	ai	R2, #1
	si	X1, #1, Z
	b	l_rtc_recv_lp

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_rtc_recv_fail

	mv	R2, R1
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_rtc_done

l_rtc_recv_fail:
	bald	g_hshk_finalize_recv
l_rtc_fail:
	mvwi	R0, #HSHK_NG_OTHER
l_rtc_done:
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 1Dh 温度生値取得
; @return R0 - OK / NG_OTHER
; @return R1 - 温度生値16bit
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_temp_get_raw_:
	push	R3
	push	R4

	mvwi	R0, #HSHK_CMD_TEMP_GET_RAW
	bald	l_sensor_begin
	cwi	R0, #HSHK_OK, Z
	b	l_temp_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_temp_recv_fail
	andi	R1, #0x00ff
	bswp	R2, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_temp_recv_fail
	andi	R1, #0x00ff
	or	R2, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_temp_recv_fail

	mv	R3, R1			; status
	bald	g_hshk_finalize_recv
	mv	R0, R3
	andi	R0, #0x00ff
	mv	R1, R2
	andi	R1, #0xffff
	b	l_temp_done

l_temp_recv_fail:
	bald	g_hshk_finalize_recv
l_temp_fail:
	mvwi	R0, #HSHK_NG_OTHER
	eor	R1, R1
l_temp_done:
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 1Eh 光センサー生値取得
; @param R0 - 結果バッファ先頭（ワードアドレス。C,R,G,B の 4 ワード）
; @return R0 - OK / NG_OTHER
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_light_get_raw_:
	push	R3
	push	R4
	mv	R2, R0

	mvwi	R0, #HSHK_CMD_LIGHT_GET_RAW
	bald	l_sensor_begin
	cwi	R0, #HSHK_OK, Z
	b	l_light_fail

	; clear
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	bswp	R4, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	or	R4, R1

	mv	X0, R2
	st	R4, 0(X0)
	ai	R2, #1

	; red
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	bswp	R4, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	or	R4, R1

	mv	X0, R2
	st	R4, 0(X0)
	ai	R2, #1

	; green
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	bswp	R4, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	or	R4, R1

	mv	X0, R2
	st	R4, 0(X0)
	ai	R2, #1

	; blue
	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	bswp	R4, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail
	andi	R1, #0x00ff
	or	R4, R1

	mv	X0, R2
	st	R4, 0(X0)
	ai	R2, #1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_light_recv_fail

	mv	R2, R1			; status
	bald	g_hshk_finalize_recv
	mv	R0, R2
	andi	R0, #0x00ff
	b	l_light_done

l_light_recv_fail:
	bald	g_hshk_finalize_recv
l_light_fail:
	mvwi	R0, #HSHK_NG_OTHER
l_light_done:
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 1Fh 距離センサー生値取得
; @return R0 - OK / NG_OTHER
; @return R1 - 距離16bit
; @return R2 - rangeStatus(下位5bit)
; @Destruction R0, R1, R2
; -------------------------------------------------------
g_bios_distance_get_raw_:
	push	R3
	push	R4

	mvwi	R0, #HSHK_CMD_DISTANCE_GET_RAW
	bald	l_sensor_begin
	cwi	R0, #HSHK_OK, Z
	b	l_dist_fail

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_dist_recv_fail
	andi	R1, #0x00ff
	bswp	R2, R1

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_dist_recv_fail
	andi	R1, #0x00ff
	or	R2, R1
	push	R2			; distance

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_dist_recv_fail_d
	andi	R1, #0x001f
	push	R1			; rangeStatus

	bald	g_hshk_recv_byte
	cwi	R0, #HSHK_OK, Z
	b	l_dist_recv_fail_dr

	mv	R3, R1			; status
	bald	g_hshk_finalize_recv
	mv	R0, R3
	andi	R0, #0x00ff
	pop	R2			; rangeStatus
	andi	R2, #0x001f
	pop	R1			; distance
	andi	R1, #0xffff
	b	l_dist_done

l_dist_recv_fail_dr:
	pop	R1			; rangeStatus 捨て
l_dist_recv_fail_d:
	pop	R1			; distance 捨て
l_dist_recv_fail:
	bald	g_hshk_finalize_recv
l_dist_fail:
	mvwi	R0, #HSHK_NG_OTHER
	eor	R1, R1
	eor	R2, R2
l_dist_done:
	pop	R4
	pop	R3
	ret

; -------------------------------------------------------
; 共通: コマンド送信〜受理
; @param R0 - 送信コマンド
; @return R0 - HSHK_OK / HSHK_NG
; @Destruction R0, R1
; -------------------------------------------------------
l_sensor_begin:
	push	R3
	mv	R3, R0

	bald	g_hshk_initiate_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_sensor_begin_fail

	mv	R0, R3
	bald	g_hshk_send_byte
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_sensor_begin_fail

	bald	g_hshk_finalize_send
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_sensor_begin_fail

	bald	g_hshk_wait_req1_1
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_sensor_begin_fail

	bald	g_hshk_accept_request
	mv	R1, R0
	mvwi	R0, #HSHK_OK
	c	R1, R0, Z
	b	l_sensor_begin_fail

	mvwi	R0, #HSHK_OK
	pop	R3
	ret

l_sensor_begin_fail:
	mvwi	R0, #HSHK_NG
	pop	R3
	ret
