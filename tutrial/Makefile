# tutrial — MN1613 チュートリアル IHX ビルド
#
#   make ihx     … 各サンプルの .asm → .rel → sdld → Intel HEX + CDB
#   make clean   … 各サンプルの build/ を削除
#
# サンプル配置: <name>/src/mn1613/<stem>.asm → <name>/build/hex/<stem>.ihx
# BIOS エントリは tutrial/bios.inc（_BIOS ジャンプ表）。モニタ本体はリンクしない。
# エミュは F7 RST でモニタを DMA したあと、この IHX を載せて 1800h から RUN。

SHELL := /bin/bash

TUT_DIR   := $(abspath .)
ROOT_DIR  := $(abspath ..)
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

# 相対パスで拾う（abspath の wildcard は環境によって空になる）
ASM_SRCS := $(sort $(wildcard */src/mn1613/*.asm))
ifeq ($(ASM_SRCS),)
$(error no samples: expected */src/mn1613/*.asm under $(TUT_DIR))
endif

# $(1)=src  $(2)=stem  $(3)=sample  $(4)=MODULE
define TUT_ASM_RULES
ALL_IHX += $(3)/build/hex/$(2).ihx

$(3)/build/obj/$(2).rel: $(1) $$(BIOS_INC) | retrocpu-asm-build
	@mkdir -p $$(dir $$@)
	node $$(ASM_CLI) --cpu mn1613 $$< -o $$@ --lst $(3)/build/obj/$(2).lst --module $(4)

$(3)/build/hex/$(2).ihx: $(3)/build/obj/$(2).rel $$(SDLD_LINK_CLI)
	@mkdir -p $$(dir $$@)
	node $$(SDLD_LINK_CLI) $$< -o $$@ --cdb $(3)/build/hex/$(2).cdb
	@echo "Wrote $$@"
	@echo "Wrote $(3)/build/hex/$(2).cdb"
endef

$(foreach src,$(ASM_SRCS),$(eval $(call TUT_ASM_RULES,$(src),$(basename $(notdir $(src))),$(firstword $(subst /, ,$(src))),$(shell echo $(basename $(notdir $(src))) | tr '[:lower:]' '[:upper:]'))))

.PHONY: all help ihx clean retrocpu-asm-build

all: ihx

help:
	@echo "tutrial"
	@echo "  make ihx     各サンプルの IHX / CDB を出す"
	@echo "  make clean   各サンプルの build/ を削除"
	@echo "samples:"
	@$(foreach s,$(ALL_IHX),echo "  $(s)";)

retrocpu-asm-build:
	@if [ ! -f "$(ASM_CLI)" ] || [ ! -f "$(SDLD_LINK_CLI)" ]; then \
		echo "==> building retrocpu_asm"; \
		cd $(RETROCPU_ASM_DIR) && npm install && npm run build; \
	fi
	@test -f "$(ASM_CLI)"
	@test -f "$(SDLD_LINK_CLI)"

ihx: $(ALL_IHX)

clean:
	rm -rf $(TUT_DIR)/*/build
