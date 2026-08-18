# tutorial — MN1613 チュートリアル IHX ビルド
#
#   make / make all / make ihx
#         配下の全プログラム（**/src/mn1613/*.asm）を Intel HEX + CDB にする
#   make <sample>         そのディレクトリ 1 件だけ
#   make clean            各サンプルの build/ を削除
#
# 配置: <sample>/src/mn1613/<stem>.asm → <sample>/build/hex/<stem>.ihx
# 新しいサンプルはディレクトリを足すだけで対象になる（列挙しない）。
# BIOS エントリは tutorial/bios.inc（_BIOS ジャンプ表）。モニタ本体はリンクしない。
# エミュは F7 RST でモニタを DMA したあと、この IHX を載せて 1800h から RUN。
#
# cwd は問わない（Makefile のあるディレクトリ基準）。

SHELL := /bin/bash

# 先頭サンプルの .PHONY がデフォルトにならないよう先に固定する
.DEFAULT_GOAL := all

TUT_DIR   := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ROOT_DIR  := $(abspath $(TUT_DIR)/..)
BIOS_INC  := $(TUT_DIR)/bios.inc

RETROCPU_ASM_DIR ?= $(ROOT_DIR)/retrocpu_asm
ASM_CLI          := $(RETROCPU_ASM_DIR)/dist/main/cli.js
SDLD_LINK_CLI    := $(RETROCPU_ASM_DIR)/dist/main/sdldLinkCli.js

SDCC_SRC_DIR ?= $(HOME)/sdcc-mn1613/sdcc/build/sdcc
ifeq ("$(wildcard $(SDCC_SRC_DIR)/bin/sdld)","")
ifneq ("$(wildcard $(HOME)/sdcc-mn1613/sdcc/sdcc/bin/sdld)","")
SDCC_SRC_DIR := $(HOME)/sdcc-mn1613/sdcc/sdcc
endif
endif
SDCC_BIN_DIR ?= $(SDCC_SRC_DIR)/bin
export PATH := $(SDCC_BIN_DIR):$(PATH)
export SDCC_BIN_DIR
export SDLD := $(SDCC_BIN_DIR)/sdld

.DELETE_ON_ERROR:

# 配下すべての src/mn1613/*.asm（深さは問わない）
ASM_SRCS := $(sort $(shell find "$(TUT_DIR)" -type f -path '*/src/mn1613/*.asm'))
ifeq ($(ASM_SRCS),)
$(error no samples: expected **/src/mn1613/*.asm under $(TUT_DIR))
endif

ALL_IHX :=
SAMPLE_NAMES :=

# $(1)=abs src  $(2)=stem  $(3)=sample  $(4)=MODULE
define TUT_ASM_RULES
ALL_IHX += $(TUT_DIR)/$(3)/build/hex/$(2).ihx
SAMPLE_NAMES += $(3)

.PHONY: $(3)
$(3): $(TUT_DIR)/$(3)/build/hex/$(2).ihx

$(TUT_DIR)/$(3)/build/obj/$(2).rel: $(1) $(BIOS_INC) | retrocpu-asm-build
	@mkdir -p $$(dir $$@)
	node $$(ASM_CLI) --cpu mn1613 $$< -o $$@ --lst $(TUT_DIR)/$(3)/build/obj/$(2).lst --module $(4)

$(TUT_DIR)/$(3)/build/hex/$(2).ihx: $(TUT_DIR)/$(3)/build/obj/$(2).rel $$(SDLD_LINK_CLI)
	@mkdir -p $$(dir $$@)
	@test -x "$$(SDLD)" || { echo "sdld がありません: $$(SDLD)"; echo "retrocpu_boot_monitor で make sdcc-setup"; exit 1; }
	node $$(SDLD_LINK_CLI) $$< -o $$@ --cdb $(TUT_DIR)/$(3)/build/hex/$(2).cdb
	@echo "Wrote $$@"
	@echo "Wrote $(3)/build/hex/$(2).cdb"
endef

$(foreach src,$(ASM_SRCS),$(eval $(call TUT_ASM_RULES,$(src),$(basename $(notdir $(src))),$(firstword $(subst /, ,$(patsubst $(TUT_DIR)/%,%,$(src)))),$(shell echo $(basename $(notdir $(src))) | tr '[:lower:]' '[:upper:]'))))

SAMPLE_NAMES := $(sort $(SAMPLE_NAMES))

.PHONY: all help ihx clean retrocpu-asm-build $(SAMPLE_NAMES)

all: ihx

help:
	@echo "tutorial"
	@echo "  make / make all / make ihx   配下の全プログラムをビルド"
	@echo "  make <sample>                1 件だけビルド"
	@echo "  make clean                   各サンプルの build/ を削除"
	@echo "samples:"
	@$(foreach s,$(SAMPLE_NAMES),echo "  $(s)";)

retrocpu-asm-build:
	@if [ ! -f "$(ASM_CLI)" ] || [ ! -f "$(SDLD_LINK_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"
	@test -f "$(SDLD_LINK_CLI)"

ihx: $(ALL_IHX)
	@echo "IHX ($(words $(ALL_IHX))):"
	@$(foreach s,$(ALL_IHX),echo "  $(s)";)

clean:
	find "$(TUT_DIR)" -type d -name build -prune -exec rm -rf {} +
