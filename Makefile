# LCD HELLO WORLD チュートリアル（MN1613）
#
#   make ihx     … hello_lcd.ihx / .cdb（開始ワード 1800h）
#   make clean
#
# ブートモニタの CDB から BIOS アドレスを取り、ユーザ IHX だけ出す。
# エミュは RST でモニタを載せたあと、この IHX を DMA し 1800h から RUN。

SHELL := /bin/bash
REPO_DIR        := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

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

.PHONY: all help ihx clean monitor retrocpu-asm-build \
	tscheck tscheck-all \
	tscheck-retrocpu-emu tscheck-retrocpu-test-framework tscheck-retrocpu-boot-monitor \
	tscheck-retrocpu-asm tscheck-debug-expand tscheck-asm-editor \
	tstest tstest-all \
	tstest-retrocpu-asm tstest-retrocpu-test-framework tstest-retrocpu-boot-monitor \
	tstest-retrocpu-emu tstest-debug-expand tstest-asm-editor

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

# Run TypeScript static analysis for all TS subprojects with one command.
tscheck: tscheck-all

tscheck-all:
	@failed=0; \
	for target in \
		tscheck-retrocpu-emu \
		tscheck-retrocpu-test-framework \
		tscheck-retrocpu-boot-monitor \
		tscheck-retrocpu-asm \
		tscheck-debug-expand \
		tscheck-asm-editor; do \
		$(MAKE) $$target || failed=1; \
	done; \
	if [ $$failed -ne 0 ]; then \
		echo "TypeScript static analysis finished with errors."; \
		exit 1; \
	fi; \
	echo "TypeScript static analysis completed for all projects."

tscheck-retrocpu-emu:
	@echo "==> retrocpu_emu: npm run typecheck"
	@cd $(REPO_DIR)/retrocpu_emu && npm run typecheck

tscheck-retrocpu-test-framework:
	@echo "==> retrocpu_test_framework: npm run typecheck"
	@cd $(REPO_DIR)/retrocpu_test_framework && npm run typecheck

tscheck-retrocpu-boot-monitor:
	@echo "==> retrocpu_boot_monitor: npm run typecheck"
	@cd $(REPO_DIR)/retrocpu_boot_monitor && npm run typecheck

tscheck-retrocpu-asm:
	@echo "==> retrocpu_asm: npm exec -- tsc -p tsconfig.json --noEmit"
	@cd $(REPO_DIR)/retrocpu_asm && npm exec -- tsc -p tsconfig.json --noEmit

tscheck-debug-expand:
	@echo "==> cursor_expand/debug_expand: npm run lint"
	@cd $(REPO_DIR)/cursor_expand/debug_expand && npm run lint

tscheck-asm-editor:
	@echo "==> cursor_expand/retrocpu_asm_editor: npm run lint"
	@cd $(REPO_DIR)/cursor_expand/retrocpu_asm_editor && npm run lint

# Run TypeScript-related test suites for all subprojects with one command.
TS_TEST_SDCC_BIN_DIR ?= $(HOME)/sdcc-mn1613/sdcc/sdcc/bin
TS_TEST_SDLD ?= $(TS_TEST_SDCC_BIN_DIR)/sdld

tstest: tstest-all

tstest-all:
	@failed=0; \
	for target in \
		tstest-retrocpu-asm \
		tstest-retrocpu-test-framework \
		tstest-retrocpu-boot-monitor \
		tstest-retrocpu-emu \
		tstest-debug-expand \
		tstest-asm-editor; do \
		$(MAKE) $$target || failed=1; \
	done; \
	if [ $$failed -ne 0 ]; then \
		echo "TypeScript tests finished with errors."; \
		exit 1; \
	fi; \
	echo "TypeScript tests completed for all projects."

tstest-retrocpu-asm:
	@echo "==> retrocpu_asm: npm test"
	@cd $(REPO_DIR)/retrocpu_asm && \
		SDCC_BIN_DIR=$(TS_TEST_SDCC_BIN_DIR) \
		SDLD=$(TS_TEST_SDLD) \
		PATH=$(TS_TEST_SDCC_BIN_DIR):$$PATH \
		npm test

tstest-retrocpu-test-framework:
	@echo "==> retrocpu_test_framework: npm test"
	@cd $(REPO_DIR)/retrocpu_test_framework && \
		SDCC_BIN_DIR=$(TS_TEST_SDCC_BIN_DIR) \
		SDLD=$(TS_TEST_SDLD) \
		PATH=$(TS_TEST_SDCC_BIN_DIR):$$PATH \
		npm test

tstest-retrocpu-boot-monitor:
	@echo "==> retrocpu_boot_monitor: npm test"
	@cd $(REPO_DIR)/retrocpu_boot_monitor && \
		SDCC_BIN_DIR=$(TS_TEST_SDCC_BIN_DIR) \
		SDLD=$(TS_TEST_SDLD) \
		PATH=$(TS_TEST_SDCC_BIN_DIR):$$PATH \
		npm test

tstest-retrocpu-emu:
	@echo "==> retrocpu_emu: npm test"
	@cd $(REPO_DIR)/retrocpu_emu && npm test

tstest-debug-expand:
	@echo "==> cursor_expand/debug_expand: npm test"
	@cd $(REPO_DIR)/cursor_expand/debug_expand && npm test

tstest-asm-editor:
	@echo "==> cursor_expand/retrocpu_asm_editor: npm test"
	@cd $(REPO_DIR)/cursor_expand/retrocpu_asm_editor && npm test
