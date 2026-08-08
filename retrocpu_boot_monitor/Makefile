# retrocpu_boot_monitor — MN1613 モニター IHX ビルド
#
# 主なターゲット:
#   make ihx          … 各 .asm → .rel → mn1613link → Intel HEX + CDB
#   make test         … mn1613/test の結合テスト（テストフレームワーク経由）
#   make sdcc-setup   … SDCC (sdasmn1613 / sdld) を CMake 経由で構築（任意）
#   make clean        … ビルド成果物を削除
#
# .asm はインクルードせず、モジュールごとにアセンブルしてリンカで結合する。
# main.rel を必ず先頭にする。

SHELL := /bin/bash

ROOT_DIR      := $(abspath ..)
MONITOR_DIR   := $(abspath .)
MN1613_DIR    := $(MONITOR_DIR)/mn1613
SRC_DIR       := $(MN1613_DIR)/src
BUILD_DIR     := $(MONITOR_DIR)/build
OBJ_DIR       := $(BUILD_DIR)/obj
HEX_DIR       := $(BUILD_DIR)/hex
TOOLS_DIR     := $(MONITOR_DIR)/tools

# --- SDCC（任意。bin_to_ihx 経路では不要） ---
SDCC_SRC_DIR  ?= $(HOME)/sdcc-mn1613/sdcc/build/sdcc
SDCC_BIN_DIR  ?= $(SDCC_SRC_DIR)/bin
CMAKE_DIR     := $(BUILD_DIR)/cmake

# --- retrocpu_asm ---
RETROCPU_ASM_DIR ?= $(ROOT_DIR)/retrocpu_asm
ASM_CLI       := $(RETROCPU_ASM_DIR)/dist/main/cli.js
LINK_CLI      := $(RETROCPU_ASM_DIR)/dist/main/linkCli.js
BIN_TO_IHX    := $(TOOLS_DIR)/bin_to_ihx.js

# --- ツール ---
export PATH := $(SDCC_BIN_DIR):$(PATH)
SDASMN1613    := $(SDCC_BIN_DIR)/sdasmn1613
SDLD          := $(SDCC_BIN_DIR)/sdld

TARGET_NAME   := mn1613_mon
IHX           := $(HEX_DIR)/$(TARGET_NAME).ihx
BIN           := $(HEX_DIR)/$(TARGET_NAME).bin
CDB           := $(HEX_DIR)/$(TARGET_NAME).cdb

ASM_SRCS := \
	$(SRC_DIR)/main.asm \
	$(SRC_DIR)/interrupt.asm \
	$(SRC_DIR)/handshake/handshake_common.asm \
	$(SRC_DIR)/handshake/handshake_main.asm \
	$(SRC_DIR)/handshake/handshake_timer.asm \
	$(SRC_DIR)/bios/bios_common.asm

REL_MAIN      := $(OBJ_DIR)/main.rel
REL_INT       := $(OBJ_DIR)/interrupt.rel
REL_HSHK_C    := $(OBJ_DIR)/handshake_common.rel
REL_HSHK_M    := $(OBJ_DIR)/handshake_main.rel
REL_HSHK_T    := $(OBJ_DIR)/handshake_timer.rel
REL_BIOS      := $(OBJ_DIR)/bios_common.rel
RELS          := $(REL_MAIN) $(REL_INT) $(REL_HSHK_C) $(REL_HSHK_M) $(REL_HSHK_T) $(REL_BIOS)

INC_DEPS := \
	$(SRC_DIR)/memmap.inc \
	$(SRC_DIR)/interrupt_io.inc \
	$(SRC_DIR)/handshake/handshake_io.inc

.PHONY: all help sdcc-setup retrocpu-asm-build ihx assemble link test clean clean-sdcc

all: ihx

help:
	@echo "retrocpu_boot_monitor"
	@echo "  make ihx            各 .asm → .rel → mn1613link → Intel HEX + CDB"
	@echo "  make test           mn1613/test 結合テスト（テストフレームワーク）"
	@echo "  make sdcc-setup     Build sdasmn1613 + sdld via CMake (optional)"
	@echo "  make clean          Remove monitor build/ artifacts"
	@echo ""
	@echo "SDCC_SRC_DIR=$(SDCC_SRC_DIR)"

# -------------------------------------------------------
# 結合テスト（retrocpu_test_framework。このプロジェクトの test のみ）
# -------------------------------------------------------
test:
	npm test

# -------------------------------------------------------
# 1. SDCC 環境（任意）
# -------------------------------------------------------
sdcc-setup: $(SDASMN1613) $(SDLD)
	@echo "SDCC tools ready:"
	@echo "  $(SDASMN1613)"
	@echo "  $(SDLD)"

$(SDASMN1613) $(SDLD):
	@if command -v cmake >/dev/null 2>&1; then \
		mkdir -p $(CMAKE_DIR); \
		cmake -S $(MONITOR_DIR) -B $(CMAKE_DIR) \
			-DSDCC_SRC_DIR=$(SDCC_SRC_DIR) \
			-DSDCC_BIN_DIR=$(SDCC_BIN_DIR); \
		cmake --build $(CMAKE_DIR) --target sdcc_mn1613_tools; \
	else \
		echo "cmake not found; building SDCC tools via make directly"; \
		$(MAKE) -C $(SDCC_SRC_DIR)/sdas/asmn1613; \
		$(MAKE) -C $(SDCC_SRC_DIR)/sdas/linksrc sdcc-ld8051; \
	fi
	@test -x $(SDASMN1613)
	@test -x $(SDLD)

# -------------------------------------------------------
# retrocpu_asm CLI
# -------------------------------------------------------
retrocpu-asm-build:
	@if [ ! -f "$(ASM_CLI)" ] || [ ! -f "$(LINK_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"
	@test -f "$(LINK_CLI)"

# -------------------------------------------------------
# 2. Intel HEX（各 .asm → .rel → mn1613link → IHX）
# -------------------------------------------------------
ihx: retrocpu-asm-build $(IHX)
	@echo "Wrote $(IHX)"

$(OBJ_DIR):
	@mkdir -p $@

$(HEX_DIR):
	@mkdir -p $@

$(REL_MAIN): $(SRC_DIR)/main.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module MAIN

$(REL_INT): $(SRC_DIR)/interrupt.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module INTERRUPT

$(REL_HSHK_C): $(SRC_DIR)/handshake/handshake_common.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module HSHK_COMMON

$(REL_HSHK_M): $(SRC_DIR)/handshake/handshake_main.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module HSHK_MAIN

$(REL_HSHK_T): $(SRC_DIR)/handshake/handshake_timer.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module HSHK_TIMER

$(REL_BIOS): $(SRC_DIR)/bios/bios_common.asm $(INC_DEPS) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module BIOS_COMMON

$(BIN): $(RELS) | $(HEX_DIR)
	node $(LINK_CLI) $(RELS) -o $@ --cdb $(CDB)

$(IHX): $(BIN) $(BIN_TO_IHX)
	node $(BIN_TO_IHX) $(BIN) $@

assemble: $(RELS)

link: $(BIN)

clean:
	rm -rf $(BUILD_DIR)

clean-sdcc: clean
	@$(MAKE) -C $(SDCC_SRC_DIR)/sdas/asmn1613 clean 2>/dev/null || true
	@$(MAKE) -C $(SDCC_SRC_DIR)/sdas/linksrc clean 2>/dev/null || true
	@rm -f $(SDLD) 2>/dev/null || true
