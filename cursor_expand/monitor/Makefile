# cursor_expand/monitor — SDCC ツールチェーン＋ MN1613 モニター IHX ビルド
#
# 主なターゲット:
#   make sdcc-setup   … SDCC (sdasmn1613 / sdld) を CMake 経由で構築
#   make ihx          … retrocpu_asm + (asxxxx 変換) + sdld → Intel HEX
#   make clean        … ビルド成果物を削除
#
# 開始アドレスはソースの .org ではなく CODE_BASE_WORD（既定 0x0200）と
# link/mn1613.lnk の -b _CODE で指定する（ワード→バイトは ×2）。

SHELL := /bin/bash

ROOT_DIR      := $(abspath ../..)
MONITOR_DIR   := $(abspath .)
MN1613_DIR    := $(MONITOR_DIR)/mn1613
SRC_DIR       := $(MN1613_DIR)/src
LINK_DIR      := $(MN1613_DIR)/link
BUILD_DIR     := $(MONITOR_DIR)/build
OBJ_DIR       := $(BUILD_DIR)/obj
HEX_DIR       := $(BUILD_DIR)/hex
TOOLS_DIR     := $(MONITOR_DIR)/tools

# --- SDCC（configure 済みツリー。bin/ にツールが出る） ---
SDCC_SRC_DIR  ?= $(HOME)/sdcc-mn1613/sdcc/build/sdcc
SDCC_BIN_DIR  ?= $(SDCC_SRC_DIR)/bin
CMAKE_DIR     := $(BUILD_DIR)/cmake

# --- retrocpu_asm ---
RETROCPU_ASM_DIR ?= $(ROOT_DIR)/retrocpu_asm
ASM_CLI       := $(RETROCPU_ASM_DIR)/dist/main/cli.js
REL_TO_ASXXXX := $(TOOLS_DIR)/rel_to_asxxxx.js
AMALGAM_TOOL  := $(TOOLS_DIR)/amalgam_asm.js

# --- ツール ---
export PATH := $(SDCC_BIN_DIR):$(PATH)
SDASMN1613    := $(SDCC_BIN_DIR)/sdasmn1613
SDLD          := $(SDCC_BIN_DIR)/sdld

# モニター開始（ワード）。バイトアドレスは ×2（REL/HEX 規約）
CODE_BASE_WORD ?= 0x0200
CODE_BASE_BYTE := $(shell printf '0x%04X' $$(($(CODE_BASE_WORD) * 2)))

TARGET_NAME   := mn1613_mon
IHX           := $(HEX_DIR)/$(TARGET_NAME).ihx
LNK_TMPL      := $(LINK_DIR)/mn1613.lnk

# include-once で単一モジュール化（.equ 二重定義・外部 BALD を回避）
ASM_ENTRY     := $(SRC_DIR)/start.asm
AMALGAM       := $(BUILD_DIR)/$(TARGET_NAME).amalgam.asm
RAW_REL       := $(OBJ_DIR)/$(TARGET_NAME).rel
ASXXXX_REL    := $(OBJ_DIR)/$(TARGET_NAME).asxxxx.rel

.PHONY: all help sdcc-setup retrocpu-asm-build ihx assemble link clean clean-sdcc

all: ihx

help:
	@echo "cursor_expand/monitor"
	@echo "  make sdcc-setup     Build sdasmn1613 + sdld via CMake (or direct make)"
	@echo "  make ihx            retrocpu_asm → asxxxx REL → sdld → Intel HEX"
	@echo "  make clean          Remove monitor build/ artifacts"
	@echo "  make clean-sdcc     Also clean SDCC asmn1613/linksrc objects"
	@echo ""
	@echo "CODE_BASE_WORD=$(CODE_BASE_WORD)  (byte $(CODE_BASE_BYTE))"
	@echo "SDCC_SRC_DIR=$(SDCC_SRC_DIR)"

# -------------------------------------------------------
# 1. SDCC 環境（CMake があれば CMake、無ければ直接 make）
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
	@if [ ! -f "$(ASM_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"

# -------------------------------------------------------
# 2. Intel HEX（amalgam → retrocpu_asm → asxxxx REL → sdld）
# -------------------------------------------------------
ihx: sdcc-setup retrocpu-asm-build $(IHX)
	@echo "Wrote $(IHX) (CODE_BASE_WORD=$(CODE_BASE_WORD) / byte $(CODE_BASE_BYTE))"

$(OBJ_DIR):
	@mkdir -p $@

$(HEX_DIR):
	@mkdir -p $@

$(BUILD_DIR):
	@mkdir -p $@

$(AMALGAM): $(ASM_ENTRY) $(SRC_DIR)/interrupt.asm $(SRC_DIR)/handshake/handshake_common.asm \
		$(SRC_DIR)/interrupt_io.inc $(SRC_DIR)/handshake/handshake_io.inc \
		$(AMALGAM_TOOL) | $(BUILD_DIR)
	node $(AMALGAM_TOOL) $(ASM_ENTRY) -o $@

$(RAW_REL): $(AMALGAM) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $(AMALGAM) -o $@ --lst $(basename $@).lst \
		--module $(TARGET_NAME)

$(ASXXXX_REL): $(RAW_REL) $(REL_TO_ASXXXX)
	node $(REL_TO_ASXXXX) $(RAW_REL) -o $@

$(IHX): $(ASXXXX_REL) $(GEN_LNK) $(SDLD) | $(HEX_DIR)
	@# sdld は入力 .rel と同階層に .ihx を出すため、hex へコピーしてからリンクする
	cp -f $(ASXXXX_REL) $(HEX_DIR)/$(TARGET_NAME).rel
	@sed -e 's/@CODE_BASE_BYTE@/$(CODE_BASE_BYTE)/g' \
		-e 's|@REL@|$(TARGET_NAME).rel|g' \
		$(LNK_TMPL) > $(HEX_DIR)/$(TARGET_NAME).lnk
	cd $(HEX_DIR) && $(SDLD) -f $(TARGET_NAME).lnk
	@test -f $(IHX)

assemble: $(ASXXXX_REL)

link: $(IHX)

clean:
	rm -rf $(BUILD_DIR)

clean-sdcc: clean
	@$(MAKE) -C $(SDCC_SRC_DIR)/sdas/asmn1613 clean 2>/dev/null || true
	@$(MAKE) -C $(SDCC_SRC_DIR)/sdas/linksrc clean 2>/dev/null || true
	@rm -f $(SDLD) 2>/dev/null || true
