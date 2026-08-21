; センサー生値取得（ハンドシェイク 1Ch–1Fh）
; RTC/光: R2=バッファ → 戻り R2=status
; 温度: R2=status, R3=生値16bit
; 距離: R2=status, R3=距離, R4=RangeStatus

	.cpu	tms9995
	.include "../memmap.inc"
	.include "handshake_io.inc"

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

	.area	_CODE		(REL,CON)

; -------------------------------------------------------
; 1Ch RTC 生値 7B → バッファ（1 ワード 1 バイト）+ status
; @param R2 - バッファ先頭
; @return R2 - OK / NG_OTHER
; -------------------------------------------------------
g_bios_rtc_get_raw_:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R5
	LI	R2, #HSHK_CMD_RTC_GET_RAW
	BL	l_sensor_begin
	CI	R2, #HSHK_OK
	JNE	l_rtc_fail

	LI	R4, #HSHK_RTC_RAW_BYTES
l_rtc_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rtc_recv_fail
	ANDI	R3, #0x00ff
	MOV	R3, (R5)
	AI	R5, #2
	AI	R4, #-1
	JNE	l_rtc_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rtc_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	(R10)+, R11
	B	(R11)

l_rtc_recv_fail:
	BL	g_hshk_finalize_recv
l_rtc_fail:
	LI	R2, #HSHK_NG_OTHER
	MOV	(R10)+, R11
	B	(R11)

; -------------------------------------------------------
; 1Dh 温度生値
; @return R2 - status
; @return R3 - 生値16bit BE
; -------------------------------------------------------
g_bios_temp_get_raw_:
	DECT	R10
	MOV	R11, (R10)
	LI	R2, #HSHK_CMD_TEMP_GET_RAW
	BL	l_sensor_begin
	CI	R2, #HSHK_OK
	JNE	l_temp_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	ANDI	R3, #0x00ff
	SOC	R3, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	R5, R3
	MOV	(R10)+, R11
	B	(R11)

l_temp_recv_fail:
	BL	g_hshk_finalize_recv
l_temp_fail:
	LI	R2, #HSHK_NG_OTHER
	CLR	R3
	MOV	(R10)+, R11
	B	(R11)

; -------------------------------------------------------
; 1Eh 光センサー C,R,G,B 各16bit → バッファ 4 ワード
; @param R2 - バッファ先頭
; @return R2 - status
; -------------------------------------------------------
g_bios_light_get_raw_:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R5
	LI	R2, #HSHK_CMD_LIGHT_GET_RAW
	BL	l_sensor_begin
	CI	R2, #HSHK_OK
	JNE	l_light_fail

	LI	R4, #HSHK_LIGHT_RAW_WORDS
l_light_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, (R5)
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	ANDI	R3, #0x00ff
	SOC	R3, (R5)
	AI	R5, #2
	AI	R4, #-1
	JNE	l_light_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	MOV	R3, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R2
	ANDI	R2, #0x00ff
	MOV	(R10)+, R11
	B	(R11)

l_light_recv_fail:
	BL	g_hshk_finalize_recv
l_light_fail:
	LI	R2, #HSHK_NG_OTHER
	MOV	(R10)+, R11
	B	(R11)

; -------------------------------------------------------
; 1Fh 距離
; @return R2 - status
; @return R3 - 距離
; @return R4 - RangeStatus（下位5bit）
; -------------------------------------------------------
g_bios_distance_get_raw_:
	DECT	R10
	MOV	R11, (R10)
	LI	R2, #HSHK_CMD_DISTANCE_GET_RAW
	BL	l_sensor_begin
	CI	R2, #HSHK_OK
	JNE	l_dist_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R3, #0x00ff
	SWPB	R3
	MOV	R3, R4			; 距離（上位）

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R3, #0x00ff
	SOC	R3, R4			; 距離（下位）

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R3, #0x001f
	MOV	R3, R5			; RangeStatus

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	DECT	R10
	MOV	R3, (R10)		; status（finalize をまたぐ）
	BL	g_hshk_finalize_recv
	MOV	(R10)+, R2
	ANDI	R2, #0x00ff
	MOV	R4, R3
	MOV	R5, R4
	MOV	(R10)+, R11
	B	(R11)

l_dist_recv_fail:
	BL	g_hshk_finalize_recv
l_dist_fail:
	LI	R2, #HSHK_NG_OTHER
	CLR	R3
	CLR	R4
	MOV	(R10)+, R11
	B	(R11)

; 共通: コマンド送信〜受理
; @param R2 - コマンド
; @return R2 - OK/NG
l_sensor_begin:
	DECT	R10
	MOV	R11, (R10)
	MOV	R2, R8

	BL	g_hshk_initiate_send
	CI	R2, #HSHK_OK
	JNE	l_sensor_begin_fail

	MOV	R8, R2
	BL	g_hshk_send_byte
	CI	R2, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_finalize_send
	CI	R2, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_wait_req1_1
	CI	R2, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_accept_request
	CI	R2, #HSHK_OK
	JNE	l_sensor_begin_fail

	LI	R2, #HSHK_OK
	MOV	(R10)+, R11
	B	(R11)

l_sensor_begin_fail:
	LI	R2, #HSHK_NG
	MOV	(R10)+, R11
	B	(R11)
