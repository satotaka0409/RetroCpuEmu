# retrocpu_boot_monitor — MN1613 モニター IHX ビルド
#
# 主なターゲット:
#   make ihx          … 各 .asm → .rel → sdld → Intel HEX + CDB + MAP
#   make test         … test/mn1613 の結合テスト（テストフレームワーク経由）
#   make sdcc-setup   … SDCC (sdld) を CMake 経由で構築（ihx の前提）
#   make clean        … ビルド成果物を削除
#
# .asm はインクルードせず、モジュールごとにアセンブルしてリンカで結合する。
# main.rel を必ず先頭にする。

SHELL := /bin/bash

ROOT_DIR      := $(abspath ..)
MONITOR_DIR   := $(abspath .)
MN1613_DIR    := $(MONITOR_DIR)/mn1613
SRC_DIR       := $(MONITOR_DIR)/src/mn1613
TMS9995_SRC_DIR := $(MONITOR_DIR)/src/tms9995
BUILD_DIR     := $(MONITOR_DIR)/build
OBJ_DIR       := $(BUILD_DIR)/obj/mn1613
HEX_DIR       := $(BUILD_DIR)/hex/mn1613
TMS9995_OBJ_DIR := $(BUILD_DIR)/obj/tms9995
TMS9995_HEX_DIR := $(BUILD_DIR)/hex/tms9995
TOOLS_DIR     := $(MONITOR_DIR)/tools

# --- SDCC（sdld。ihx に必須） ---
SDCC_SRC_DIR  ?= $(HOME)/sdcc-mn1613/sdcc/build/sdcc
ifeq ("$(wildcard $(SDCC_SRC_DIR)/sdas/linksrc/Makefile)","")
ifneq ("$(wildcard $(HOME)/sdcc-mn1613/sdcc/sdcc/sdas/linksrc/Makefile)","")
SDCC_SRC_DIR := $(HOME)/sdcc-mn1613/sdcc/sdcc
endif
endif
SDCC_BIN_DIR  ?= $(SDCC_SRC_DIR)/bin
CMAKE_DIR     := $(BUILD_DIR)/cmake

# --- retrocpu_asm ---
RETROCPU_ASM_DIR ?= $(ROOT_DIR)/retrocpu_asm
ASM_CLI       := $(RETROCPU_ASM_DIR)/dist/main/cli.js
SDLD_LINK_CLI := $(RETROCPU_ASM_DIR)/dist/main/sdldLinkCli.js

# --- ツール ---
export PATH := $(SDCC_BIN_DIR):$(PATH)
export SDCC_BIN_DIR
SDLD          := $(SDCC_BIN_DIR)/sdld
export SDLD

TARGET_NAME   := mn1613_mon
IHX           := $(HEX_DIR)/$(TARGET_NAME).ihx
BIN           := $(HEX_DIR)/$(TARGET_NAME).bin
CDB           := $(HEX_DIR)/$(TARGET_NAME).cdb
MAP           := $(HEX_DIR)/$(TARGET_NAME).map
TMS9995_TARGET_NAME := tms9995_mon
TMS9995_IHX   := $(TMS9995_HEX_DIR)/$(TMS9995_TARGET_NAME).ihx
TMS9995_CDB   := $(TMS9995_HEX_DIR)/$(TMS9995_TARGET_NAME).cdb
TMS9995_MAP   := $(TMS9995_HEX_DIR)/$(TMS9995_TARGET_NAME).map

ASM_SRCS := \
	$(SRC_DIR)/main.asm \
	$(SRC_DIR)/interrupt.asm \
	$(SRC_DIR)/breakpoint/breakpoint.asm \
	$(SRC_DIR)/breakpoint/breakpoint_hist.asm \
	$(SRC_DIR)/breakpoint/breakpoint_steprun.asm \
	$(SRC_DIR)/bios/bios_common.asm \
	$(SRC_DIR)/handshake/handshake_common.asm \
	$(SRC_DIR)/handshake/handshake_main.asm \
	$(SRC_DIR)/handshake/handshake_address_break.asm \
	$(SRC_DIR)/handshake/handshake_chg_mode.asm \
	$(SRC_DIR)/handshake/handshake_hex_keyboard.asm \
	$(SRC_DIR)/handshake/handshake_pc_keyboard.asm \
	$(SRC_DIR)/handshake/handshake_led.asm \
	$(SRC_DIR)/handshake/handshake_beep.asm \
	$(SRC_DIR)/handshake/handshake_timer.asm \
	$(SRC_DIR)/handshake/handshake_get_time.asm \
	$(SRC_DIR)/handshake/handshake_undef.asm \
	$(SRC_DIR)/handshake/handshake_lcd1.asm \
	$(SRC_DIR)/handshake/handshake_lcd2.asm \
	$(SRC_DIR)/handshake/handshake_sensor_raw.asm \
	$(SRC_DIR)/handshake/handshake_read_memory.asm \
	$(SRC_DIR)/handshake/handshake_write_memory.asm \
	$(SRC_DIR)/handshake/handshake_io_rw.asm \
	$(SRC_DIR)/handshake/handshake_break_hist.asm

REL_MAIN      := $(OBJ_DIR)/main.rel
REL_INT       := $(OBJ_DIR)/interrupt.rel
REL_BP        := $(OBJ_DIR)/breakpoint.rel
REL_BP_H      := $(OBJ_DIR)/breakpoint_hist.rel
REL_BP_S      := $(OBJ_DIR)/breakpoint_steprun.rel
REL_HSHK_C    := $(OBJ_DIR)/handshake_common.rel
REL_HSHK_M    := $(OBJ_DIR)/handshake_main.rel
REL_HSHK_AB   := $(OBJ_DIR)/handshake_address_break.rel
REL_HSHK_CM   := $(OBJ_DIR)/handshake_chg_mode.rel
REL_HSHK_K    := $(OBJ_DIR)/handshake_hex_keyboard.rel
REL_HSHK_PK   := $(OBJ_DIR)/handshake_pc_keyboard.rel
REL_HSHK_L    := $(OBJ_DIR)/handshake_led.rel
REL_HSHK_B    := $(OBJ_DIR)/handshake_beep.rel
REL_HSHK_T    := $(OBJ_DIR)/handshake_timer.rel
REL_HSHK_GT   := $(OBJ_DIR)/handshake_get_time.rel
REL_HSHK_UL   := $(OBJ_DIR)/handshake_undef_led.rel
REL_HSHK_LCD1 := $(OBJ_DIR)/handshake_lcd1.rel
REL_HSHK_LCD2 := $(OBJ_DIR)/handshake_lcd2.rel
REL_HSHK_SR   := $(OBJ_DIR)/handshake_sensor_raw.rel
REL_HSHK_RM   := $(OBJ_DIR)/handshake_read_memory.rel
REL_HSHK_WM   := $(OBJ_DIR)/handshake_write_memory.rel
REL_HSHK_IO   := $(OBJ_DIR)/handshake_io_rw.rel
REL_HSHK_BH   := $(OBJ_DIR)/handshake_break_hist.rel
REL_BIOS      := $(OBJ_DIR)/bios_common.rel
RELS          := $(REL_MAIN) $(REL_INT) $(REL_BP) $(REL_BP_H) $(REL_BP_S) $(REL_BIOS) $(REL_HSHK_C) $(REL_HSHK_M) $(REL_HSHK_AB) $(REL_HSHK_CM) $(REL_HSHK_K) $(REL_HSHK_PK) $(REL_HSHK_L) $(REL_HSHK_B) $(REL_HSHK_T) $(REL_HSHK_GT) $(REL_HSHK_UL) $(REL_HSHK_LCD1) $(REL_HSHK_LCD2) $(REL_HSHK_SR) $(REL_HSHK_RM) $(REL_HSHK_WM) $(REL_HSHK_IO) $(REL_HSHK_BH)
$(RELS): $(ASM_CLI)

INC_DEPS := \
	$(SRC_DIR)/memmap.inc \
	$(SRC_DIR)/interrupt_io.inc \
	$(SRC_DIR)/handshake/handshake_io.inc

.PHONY: all help sdcc-setup retrocpu-asm-build ihx ihx-tms9995 ihx-all assemble link test test-tms9995 clean clean-sdcc

all: ihx

help:
	@echo "retrocpu_boot_monitor"
	@echo "  make ihx            各 .asm → .rel → sdld → Intel HEX + CDB + MAP"
	@echo "  make ihx-tms9995    TMS9995 monitor を Intel HEX + CDB + MAP に変換"
	@echo "  make ihx-all        MN1613 + TMS9995 の両 monitor をビルド"
	@echo "  make test           test/mn1613+tms9995（先に ihx / ihx-tms9995）"
	@echo "  make test-tms9995   test/tms9995（先に ihx-tms9995）"
	@echo "  make sdcc-setup     Build sdld via CMake (required for ihx)"
	@echo "  make clean          Remove monitor build/ artifacts"
	@echo ""
	@echo "SDCC_SRC_DIR=$(SDCC_SRC_DIR)"

# -------------------------------------------------------
# 結合テスト（retrocpu_test_framework。このプロジェクトの test のみ）
# -------------------------------------------------------
test: ihx ihx-tms9995
	npm test

test-tms9995: ihx-tms9995
	npm run test:tms9995

# -------------------------------------------------------
# 1. SDCC 環境（sdld。ihx の前提）
# -------------------------------------------------------
sdcc-setup: $(SDLD)
	@echo "SDCC tools ready:"
	@echo "  $(SDLD)"

$(SDLD):
	@if command -v cmake >/dev/null 2>&1; then \
		mkdir -p $(CMAKE_DIR); \
		cmake -S $(MONITOR_DIR) -B $(CMAKE_DIR) \
			-DSDCC_SRC_DIR=$(SDCC_SRC_DIR) \
			-DSDCC_BIN_DIR=$(SDCC_BIN_DIR); \
		cmake --build $(CMAKE_DIR) --target sdcc_mn1613_tools; \
	else \
		echo "cmake not found; building SDCC tools via make directly"; \
		$(MAKE) -C $(SDCC_SRC_DIR)/sdas/linksrc sdcc-ld8051; \
	fi
	@test -x $(SDLD)

# -------------------------------------------------------
# retrocpu_asm CLI
# -------------------------------------------------------
retrocpu-asm-build:
	@if [ ! -f "$(ASM_CLI)" ] || [ ! -f "$(SDLD_LINK_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"
	@test -f "$(SDLD_LINK_CLI)"

# -------------------------------------------------------
# 2. Intel HEX（各 .asm → .rel → sdld → IHX + CDB + MAP）
# -------------------------------------------------------
ihx: sdcc-setup retrocpu-asm-build $(IHX)
	@echo "Wrote $(IHX)"

ihx-all: ihx ihx-tms9995

$(OBJ_DIR):
	@mkdir -p $@

$(HEX_DIR):
	@mkdir -p $@

$(TMS9995_OBJ_DIR):
	@mkdir -p $@

$(TMS9995_HEX_DIR):
	@mkdir -p $@

$(REL_MAIN): $(SRC_DIR)/main.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module MAIN

$(REL_INT): $(SRC_DIR)/interrupt.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module INTERRUPT

$(REL_BP): $(SRC_DIR)/breakpoint/breakpoint.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module BREAKPOINT

$(REL_BP_H): $(SRC_DIR)/breakpoint/breakpoint_hist.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module BREAKPOINT_HIST

$(REL_BP_S): $(SRC_DIR)/breakpoint/breakpoint_steprun.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module BREAKPOINT_STEP

$(REL_HSHK_C): $(SRC_DIR)/handshake/handshake_common.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_COMMON

$(REL_HSHK_M): $(SRC_DIR)/handshake/handshake_main.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_MAIN

$(REL_HSHK_AB): $(SRC_DIR)/handshake/handshake_address_break.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_ADDR_BRK

$(REL_HSHK_CM): $(SRC_DIR)/handshake/handshake_chg_mode.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_CHG_MODE

$(REL_HSHK_K): $(SRC_DIR)/handshake/handshake_hex_keyboard.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_HEX_KEY

$(REL_HSHK_PK): $(SRC_DIR)/handshake/handshake_pc_keyboard.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_PC_KEY

$(REL_HSHK_L): $(SRC_DIR)/handshake/handshake_led.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_LED

$(REL_HSHK_B): $(SRC_DIR)/handshake/handshake_beep.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_BEEP

$(REL_HSHK_T): $(SRC_DIR)/handshake/handshake_timer.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_TIMER

$(REL_HSHK_GT): $(SRC_DIR)/handshake/handshake_get_time.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_GET_TIME

$(REL_HSHK_UL): $(SRC_DIR)/handshake/handshake_undef.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_UNDEF_LED

$(REL_HSHK_LCD1): $(SRC_DIR)/handshake/handshake_lcd1.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_LCD1

$(REL_HSHK_LCD2): $(SRC_DIR)/handshake/handshake_lcd2.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_LCD2

$(REL_HSHK_SR): $(SRC_DIR)/handshake/handshake_sensor_raw.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_SENSOR_RAW

$(REL_HSHK_RM): $(SRC_DIR)/handshake/handshake_read_memory.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_READ_MEM

$(REL_HSHK_WM): $(SRC_DIR)/handshake/handshake_write_memory.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_WRITE_MEM

$(REL_HSHK_IO): $(SRC_DIR)/handshake/handshake_io_rw.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_IO_RW

$(REL_HSHK_BH): $(SRC_DIR)/handshake/handshake_break_hist.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module HSHK_BRK_HIST

$(REL_BIOS): $(SRC_DIR)/bios/bios_common.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module BIOS_COMMON

$(IHX): $(RELS) $(SDLD) | $(HEX_DIR)
	@test -x "$(SDLD)"
	node $(SDLD_LINK_CLI) $(RELS) -o $@ --cdb $(CDB) --map $(MAP)
	cp -f $@ ../retrocpu_emu/

TMS9995_ASM_SRCS := \
	$(TMS9995_SRC_DIR)/main.asm \
	$(TMS9995_SRC_DIR)/interrupt.asm \
	$(TMS9995_SRC_DIR)/breakpoint/breakpoint.asm \
	$(TMS9995_SRC_DIR)/breakpoint/breakpoint_hist.asm \
	$(TMS9995_SRC_DIR)/breakpoint/breakpoint_state.asm \
	$(TMS9995_SRC_DIR)/breakpoint/breakpoint_steprun.asm \
	$(TMS9995_SRC_DIR)/bios/bios_common.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_common.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_main.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_address_break.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_chg_mode.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_hex_keyboard.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_pc_keyboard.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_led.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_beep.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_timer.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_get_time.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_undef.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_lcd1.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_lcd2.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_sensor_raw.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_read_memory.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_write_memory.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_io_rw.asm \
	$(TMS9995_SRC_DIR)/handshake/handshake_break_hist.asm

TMS9995_RELS := $(patsubst $(TMS9995_SRC_DIR)/%.asm,$(TMS9995_OBJ_DIR)/%.rel,$(TMS9995_ASM_SRCS))

$(TMS9995_OBJ_DIR)/%.rel: $(TMS9995_SRC_DIR)/%.asm | retrocpu-asm-build $(TMS9995_OBJ_DIR)
	@mkdir -p $(dir $@)
	@module=$$(basename "$(basename $< .asm)" | tr '[:lower:]-' '[:upper:]_'); \
	node $(ASM_CLI) $< -o $@ --lst $(basename $@).lst --module $$module

$(TMS9995_IHX): $(TMS9995_RELS) $(SDLD) | $(TMS9995_HEX_DIR)
	@test -x "$(SDLD)"
	node $(SDLD_LINK_CLI) $(TMS9995_RELS) -o $@ --cdb $(TMS9995_CDB) --map $(TMS9995_MAP) --byte-addr
	cp -f $@ ../retrocpu_emu/

ihx-tms9995: sdcc-setup retrocpu-asm-build $(TMS9995_IHX)
	@echo "Wrote $(TMS9995_IHX)"

assemble: $(RELS)

link: $(IHX)

clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(MONITOR_DIR)/logs/mn1613
	rm -rf $(MONITOR_DIR)/logs/tms9995

clean-sdcc: clean
	@$(MAKE) -C $(SDCC_SRC_DIR)/sdas/linksrc clean 2>/dev/null || true
	@rm -f $(SDLD) 2>/dev/null || true
