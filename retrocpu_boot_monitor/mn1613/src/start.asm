; start.asm
; エントリ案内のみ。.asm はインクルードしない（リンカで結合する）。
;
;   mn1613link main.rel interrupt.rel handshake_common.rel \
;              handshake_main.rel handshake_timer.rel bios_common.rel
;
; main.rel を必ず先頭にする。
