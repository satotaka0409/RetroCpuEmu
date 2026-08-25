# RetroCpuEmu リポジトリ（ワークスペース）
#
#   make / make all / make ihx
#         ブートモニタ IHX + チュートリアル全サンプル
#   make monitor      ブートモニタだけ（エミュ F7 RST に必要）
#   make tutorial     tutorial/ 配下の全プログラム
#   make cursor_expand  Cursor 拡張（debug_expand / retrocpu_asm_editor）
#   make tscheck      各 TS プロジェクトの型チェック
#   make tstest       各 TS プロジェクトのテスト
#   make help
#
# チュートリアル単体は tutorial/ で make。モニタ単体は retrocpu_boot_monitor/ で make ihx。
# 拡張単体は cursor_expand/ で make。

SHELL := /bin/bash
REPO_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

.PHONY: all help ihx monitor tutorial cursor_expand clean \
	tscheck tscheck-all \
	tscheck-retrocpu-emu tscheck-retrocpu-test-framework tscheck-retrocpu-boot-monitor \
	tscheck-retrocpu-asm tscheck-debug-expand tscheck-asm-editor \
	tstest tstest-all \
	tstest-retrocpu-asm tstest-retrocpu-test-framework tstest-retrocpu-boot-monitor \
	tstest-retrocpu-emu tstest-debug-expand tstest-asm-editor \
	typescript

all: ihx

help:
	@echo "RetroCpuEmu"
	@echo "  make / make all / make ihx   ブートモニタ + チュートリアル"
	@echo "  make monitor                 retrocpu_boot_monitor の IHX"
	@echo "  make tutorial                tutorial/ の全サンプル"
	@echo "  make cursor_expand           Cursor 拡張 2 件を compile"
	@echo "  make tscheck                 TypeScript 静的解析"
	@echo "  make tstest                  TypeScript テスト"
	@echo "  make clean                   モニタ・チュートリアル・拡張の成果物を削除"

monitor:
	@$(MAKE) -C $(REPO_DIR)/retrocpu_boot_monitor ihx

tutorial:
	@$(MAKE) -C $(REPO_DIR)/tutorial ihx

cursor_expand:
	@$(MAKE) -C $(REPO_DIR)/cursor_expand compile

ihx: monitor tutorial

clean:
	@$(MAKE) -C $(REPO_DIR)/retrocpu_boot_monitor clean
	@$(MAKE) -C $(REPO_DIR)/tutorial clean
	@$(MAKE) -C $(REPO_DIR)/cursor_expand clean

# Run TypeScript static analysis for all TS subprojects with one command.
tscheck: tscheck-all
typescript: tscheck

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
	@echo "==> retrocpu_emu_ts: npm run typecheck"
	@cd $(REPO_DIR)/retrocpu_emu_ts && npm run typecheck

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
	@echo "==> retrocpu_emu_ts: npm test"
	@cd $(REPO_DIR)/retrocpu_emu_ts && npm test

tstest-debug-expand:
	@echo "==> cursor_expand/debug_expand: npm test"
	@cd $(REPO_DIR)/cursor_expand/debug_expand && npm test

tstest-asm-editor:
	@echo "==> cursor_expand/retrocpu_asm_editor: npm test"
	@cd $(REPO_DIR)/cursor_expand/retrocpu_asm_editor && npm test

rust:
	@echo "==> Installing Rust toolchain"
	@sudo apt update && \
	sudo apt install -y curl build-essential && \
	curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \
	. "$$HOME/.cargo/env" && \
	rustup update stable && \
	rustup default stable