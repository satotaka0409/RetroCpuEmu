SHELL := /bin/bash

# ルート直下の npm プロジェクト
PROJECTS := \
	retrocpu_asm \
	retrocpu_emu \
	cursor_expand/asm_editer

.PHONY: all init clean install build help \
	clean-% install-% build-% init-% \
	sdcc-setup monitor-ihx monitor-clean

# 既定: クリーン → 依存インストール → ビルド
all: init

init: clean install build
	@echo ""
	@echo "init completed for: $(PROJECTS)"

help:
	@echo "Usage:"
	@echo "  make            # = make init"
	@echo "  make init       # clean → npm install → build（全プロジェクト）"
	@echo "  make clean      # node_modules / dist 等を削除"
	@echo "  make install    # npm install のみ"
	@echo "  make build      # 各プロジェクトのビルド"
	@echo "  make init-<dir> # 例: make init-retrocpu_asm"
	@echo "  make clean-<dir> / install-<dir> / build-<dir>"
	@echo "  make sdcc-setup # SDCC (sdasmn1613/sdld) を CMake 経由で構築"
	@echo "  make monitor-ihx# モニター Intel HEX（retrocpu_asm + sdld）"

# -------------------------------------------------------
# cursor_expand/monitor（SDCC + IHX）
# -------------------------------------------------------
sdcc-setup:
	$(MAKE) -C cursor_expand/monitor sdcc-setup

monitor-ihx:
	$(MAKE) -C cursor_expand/monitor ihx

monitor-clean:
	$(MAKE) -C cursor_expand/monitor clean

# -------------------------------------------------------
# clean: 一度消してから作り直す前提の掃除
# -------------------------------------------------------
clean:
	@for d in $(PROJECTS); do \
		echo "==> clean $$d"; \
		$(MAKE) --no-print-directory clean-dir DIR=$$d; \
	done

clean-dir:
	@test -n "$(DIR)"
	@rm -rf "$(DIR)/node_modules" \
		"$(DIR)/dist" \
		"$(DIR)/coverage" \
		"$(DIR)/.vite" \
		"$(DIR)/.turbo"
	@rm -f "$(DIR)"/*.vsix
	@echo "    removed node_modules/dist (and related) in $(DIR)"

# -------------------------------------------------------
# install
# -------------------------------------------------------
install:
	@for d in $(PROJECTS); do \
		echo "==> npm install $$d"; \
		$(MAKE) --no-print-directory install-dir DIR=$$d; \
	done

install-dir:
	@test -n "$(DIR)"
	@test -f "$(DIR)/package.json"
	@cd "$(DIR)" && npm install

# -------------------------------------------------------
# build（プロジェクトごとの npm script）
# -------------------------------------------------------
build:
	@for d in $(PROJECTS); do \
		echo "==> build $$d"; \
		$(MAKE) --no-print-directory build-dir DIR=$$d; \
	done

build-dir:
	@test -n "$(DIR)"
	@case "$(DIR)" in \
		retrocpu_asm) \
			cd "$(DIR)" && npm run build ;; \
		retrocpu_emu) \
			cd "$(DIR)" && npm run build ;; \
		cursor_expand/asm_editer) \
			cd "$(DIR)" && npm run compile ;; \
		*) \
			echo "unknown project: $(DIR)"; exit 1 ;; \
	esac

# -------------------------------------------------------
# 個別プロジェクト: make init-retrocpu_asm など
# （スラッシュは - に置き換え: make init-cursor_expand-asm_editer）
# -------------------------------------------------------
init-%:
	@$(MAKE) --no-print-directory _one GOAL=init SLUG=$*

clean-%:
	@$(MAKE) --no-print-directory _one GOAL=clean SLUG=$*

install-%:
	@$(MAKE) --no-print-directory _one GOAL=install SLUG=$*

build-%:
	@$(MAKE) --no-print-directory _one GOAL=build SLUG=$*

_one:
	@dir=$$(echo "$(SLUG)" | tr '-' '/'); \
	found=0; \
	for d in $(PROJECTS); do \
		if [ "$$d" = "$$dir" ]; then found=1; break; fi; \
	done; \
	if [ "$$found" -ne 1 ]; then \
		echo "unknown project slug: $(SLUG) (resolved: $$dir)"; \
		echo "known: $(PROJECTS)"; \
		exit 1; \
	fi; \
	case "$(GOAL)" in \
		clean) $(MAKE) --no-print-directory clean-dir DIR=$$dir ;; \
		install) $(MAKE) --no-print-directory install-dir DIR=$$dir ;; \
		build) $(MAKE) --no-print-directory build-dir DIR=$$dir ;; \
		init) \
			$(MAKE) --no-print-directory clean-dir DIR=$$dir; \
			$(MAKE) --no-print-directory install-dir DIR=$$dir; \
			$(MAKE) --no-print-directory build-dir DIR=$$dir; \
			echo "init completed for $$dir" ;; \
		*) echo "unknown goal $(GOAL)"; exit 1 ;; \
	esac
