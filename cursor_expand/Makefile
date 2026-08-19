# cursor_expand — Cursor / VS Code 拡張機能のビルド
#
#   make / make all / make compile
#         配下の拡張を npm run compile（dist/extension.js）
#   make <dir>            そのディレクトリ 1 件だけ（例: debug_expand）
#   make install          各拡張で npm install
#   make lint / make test
#   make package          vsce で .vsix
#   make clean            各 dist/ を削除
#
# 配置: cursor_expand/<name>/package.json
# 新しい拡張はディレクトリを足すだけで対象になる（列挙しない）。
#
# cwd は問わない（Makefile のあるディレクトリ基準）。

SHELL := /bin/bash

.DEFAULT_GOAL := all

EXPAND_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))

PKG_JSONS := $(sort $(wildcard $(EXPAND_DIR)/*/package.json))
ifeq ($(PKG_JSONS),)
$(error no extensions: expected */package.json under $(EXPAND_DIR))
endif

EXT_NAMES := $(patsubst $(EXPAND_DIR)/%/package.json,%,$(PKG_JSONS))

.PHONY: all help compile install lint test package clean $(EXT_NAMES)

all: compile

help:
	@echo "cursor_expand"
	@echo "  make / make all / make compile   配下の拡張を compile"
	@echo "  make <name>                      1 件だけ（$(EXT_NAMES)）"
	@echo "  make install                     各拡張で npm install"
	@echo "  make lint / make test            型チェック / テスト"
	@echo "  make package                     vsce package（.vsix）"
	@echo "  make clean                       各 dist/ を削除"

# $(1)=directory name under cursor_expand
define EXT_RULES
.PHONY: $(1)
$(1):
	@echo "==> $(1): npm run compile"
	@test -d "$(EXPAND_DIR)/$(1)/node_modules" || (cd "$(EXPAND_DIR)/$(1)" && npm install)
	cd "$(EXPAND_DIR)/$(1)" && npm run compile
endef

$(foreach name,$(EXT_NAMES),$(eval $(call EXT_RULES,$(name))))

compile: $(EXT_NAMES)

install:
	@for name in $(EXT_NAMES); do \
		echo "==> $$name: npm install"; \
		cd "$(EXPAND_DIR)/$$name" && npm install; \
	done

lint:
	@failed=0; \
	for name in $(EXT_NAMES); do \
		echo "==> $$name: npm run lint"; \
		(cd "$(EXPAND_DIR)/$$name" && npm run lint) || failed=1; \
	done; \
	if [ $$failed -ne 0 ]; then exit 1; fi

test:
	@failed=0; \
	for name in $(EXT_NAMES); do \
		echo "==> $$name: npm test"; \
		(cd "$(EXPAND_DIR)/$$name" && npm test) || failed=1; \
	done; \
	if [ $$failed -ne 0 ]; then exit 1; fi

package:
	@for name in $(EXT_NAMES); do \
		echo "==> $$name: npm run package"; \
		test -d "$(EXPAND_DIR)/$$name/node_modules" || (cd "$(EXPAND_DIR)/$$name" && npm install); \
		cd "$(EXPAND_DIR)/$$name" && npm run package; \
	done

clean:
	@for name in $(EXT_NAMES); do \
		rm -rf "$(EXPAND_DIR)/$$name/dist"; \
		echo "removed $$name/dist"; \
	done
