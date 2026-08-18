# LCD HELLO WORLD チュートリアル（MN1613）
#
#   make ihx     … hello_lcd.ihx / .cdb（開始ワード 1800h）
#   make clean
#
# ブートモニタの CDB から BIOS アドレスを取り、ユーザ IHX だけ出す。
# エミュは RST でモニタを載せたあと、この IHX を DMA し 1800h から RUN。

SHELL := /bin/bash

ROOT_DIR        := $(abspath ../..)
TUT_DIR         := $(abspath .)
SRC_DIR         := $(TUT_DIR)/src/mn1613
BUILD_DIR       := $(TUT_DIR)/build
OBJ_DIR         := $(BUILD_DIR)/obj
HEX_DIR         := $(BUILD_DIR)/hex
TOOLS_DIR       := $(TUT_DIR)/tools

MONITOR_DIR     := $(ROOT_DIR)/retrocpu_boot_monitor
MONITOR_CDB     := $(MONITOR_DIR)/build/hex/mn1613_mon.cdb
MONITOR_IHX     := $(MONITOR_DIR)/build/hex/mn1613_mon.ihx

RETROCPU_ASM_DIR ?= $(ROOT_DIR)/retrocpu_asm
ASM_CLI         := $(RETROCPU_ASM_DIR)/dist/main/cli.js
SDLD_LINK_CLI   := $(RETROCPU_ASM_DIR)/dist/main/sdldLinkCli.js

SDCC_SRC_DIR    ?= $(HOME)/sdcc-mn1613/sdcc/build/sdcc
SDCC_BIN_DIR    ?= $(SDCC_SRC_DIR)/bin
export PATH := $(SDCC_BIN_DIR):$(PATH)
export SDCC_BIN_DIR
export SDLD := $(SDCC_BIN_DIR)/sdld

TARGET_NAME     := hello_lcd
IHX             := $(HEX_DIR)/$(TARGET_NAME).ihx
CDB             := $(HEX_DIR)/$(TARGET_NAME).cdb
REL             := $(OBJ_DIR)/$(TARGET_NAME).rel
BIOS_INC        := $(SRC_DIR)/bios_addrs.inc

.PHONY: all help ihx clean monitor retrocpu-asm-build

all: ihx

help:
	@echo "tutorial/console_lcd"
	@echo "  make ihx     $(IHX) と $(CDB)"
	@echo "  make clean   ビルド成果物を削除"

retrocpu-asm-build:
	@if [ ! -f "$(ASM_CLI)" ] || [ ! -f "$(SDLD_LINK_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"
	@test -f "$(SDLD_LINK_CLI)"

monitor:
	@$(MAKE) -C $(MONITOR_DIR) ihx

$(MONITOR_CDB):
	@$(MAKE) -C $(MONITOR_DIR) ihx

$(OBJ_DIR):
	@mkdir -p $@

$(HEX_DIR):
	@mkdir -p $@

$(BIOS_INC): $(MONITOR_CDB) $(TOOLS_DIR)/gen_bios_addrs.mjs
	node $(TOOLS_DIR)/gen_bios_addrs.mjs $(MONITOR_CDB) > $@

$(REL): $(SRC_DIR)/hello_lcd.asm $(BIOS_INC) | retrocpu-asm-build $(OBJ_DIR)
	node $(ASM_CLI) --cpu mn1613 $< -o $@ --lst $(basename $@).lst --module HELLO_LCD

$(IHX): $(REL) $(SDLD_LINK_CLI) | $(HEX_DIR)
	node $(SDLD_LINK_CLI) $(REL) -o $@ --cdb $(CDB)

ihx: $(IHX)
	@echo "Wrote $(IHX)"
	@echo "Wrote $(CDB)"

clean:
	rm -rf $(BUILD_DIR)
	rm -f $(BIOS_INC)
