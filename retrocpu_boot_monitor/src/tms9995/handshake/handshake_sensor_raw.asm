; センサー生値取得（ハンドシェイク 1Ch–1Fh）
; RTC/光: R1=バッファ → 戻り R1=status
; 温度: R1=status, R2=生値16bit
; 距離: R1=status, R2=距離, R3=RangeStatus

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
; param R1 バッファ先頭
; return R1 OK / NG_OTHER
; -------------------------------------------------------
g_bios_rtc_get_raw_:
	MOV	R11, R9
	MOV	R1, R3
	LI	R1, #HSHK_CMD_RTC_GET_RAW
	BL	l_sensor_begin
	CI	R1, #HSHK_OK
	JNE	l_rtc_fail

	LI	R4, #HSHK_RTC_RAW_BYTES
l_rtc_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rtc_recv_fail
	ANDI	R1, #0x00ff
	MOV	R1, (R3)
	AI	R3, #2
	AI	R4, #-1
	JNE	l_rtc_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_rtc_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_rtc_recv_fail:
	BL	g_hshk_finalize_recv
l_rtc_fail:
	LI	R1, #HSHK_NG_OTHER
	B	(R9)

; -------------------------------------------------------
; 1Dh 温度生値
; return R1 status、R2 生値16bit BE
; -------------------------------------------------------
g_bios_temp_get_raw_:
	MOV	R11, R9
	LI	R1, #HSHK_CMD_TEMP_GET_RAW
	BL	l_sensor_begin
	CI	R1, #HSHK_OK
	JNE	l_temp_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_temp_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	MOV	R5, R2
	B	(R9)

l_temp_recv_fail:
	BL	g_hshk_finalize_recv
l_temp_fail:
	LI	R1, #HSHK_NG_OTHER
	CLR	R2
	B	(R9)

; -------------------------------------------------------
; 1Eh 光センサー C,R,G,B 各16bit → バッファ 4 ワード
; param R1 バッファ先頭
; return R1 status
; -------------------------------------------------------
g_bios_light_get_raw_:
	MOV	R11, R9
	MOV	R1, R3
	LI	R1, #HSHK_CMD_LIGHT_GET_RAW
	BL	l_sensor_begin
	CI	R1, #HSHK_OK
	JNE	l_light_fail

	LI	R4, #HSHK_LIGHT_RAW_WORDS
l_light_lp:
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5
	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5
	MOV	R5, (R3)
	AI	R3, #2
	AI	R4, #-1
	JNE	l_light_lp

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_light_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	B	(R9)

l_light_recv_fail:
	BL	g_hshk_finalize_recv
l_light_fail:
	LI	R1, #HSHK_NG_OTHER
	B	(R9)

; -------------------------------------------------------
; 1Fh 距離
; return R1 status、R2 距離、R3 RangeStatus(下位5bit)
; -------------------------------------------------------
g_bios_distance_get_raw_:
	MOV	R11, R9
	LI	R1, #HSHK_CMD_DISTANCE_GET_RAW
	BL	l_sensor_begin
	CI	R1, #HSHK_OK
	JNE	l_dist_fail

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R1, #0x00ff
	SWPB	R1
	MOV	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R1, #0x00ff
	SOC	R1, R5

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	ANDI	R1, #0x001f
	MOV	R1, R6

	BL	g_hshk_recv_byte
	CI	R2, #HSHK_OK
	JNE	l_dist_recv_fail
	MOV	R1, R4
	BL	g_hshk_finalize_recv
	MOV	R4, R1
	ANDI	R1, #0x00ff
	MOV	R5, R2
	MOV	R6, R3
	B	(R9)

l_dist_recv_fail:
	BL	g_hshk_finalize_recv
l_dist_fail:
	LI	R1, #HSHK_NG_OTHER
	CLR	R2
	CLR	R3
	B	(R9)

; 共通: コマンド送信〜受理。R9 は呼び出し元の戻り。
; param R1 コマンド
; return R1 OK/NG
l_sensor_begin:
	MOV	R11, R7
	MOV	R1, R8

	BL	g_hshk_initiate_send
	CI	R1, #HSHK_OK
	JNE	l_sensor_begin_fail

	MOV	R8, R1
	BL	g_hshk_send_byte
	CI	R1, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_finalize_send
	CI	R1, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_wait_req1_1
	CI	R1, #HSHK_OK
	JNE	l_sensor_begin_fail

	BL	g_hshk_accept_request
	CI	R1, #HSHK_OK
	JNE	l_sensor_begin_fail

	LI	R1, #HSHK_OK
	B	(R7)

l_sensor_begin_fail:
	LI	R1, #HSHK_NG
	B	(R7)
