SHELL := /bin/bash

NODE_MAJOR ?= 24
NODESOURCE_SETUP_URL := https://deb.nodesource.com/setup_$(NODE_MAJOR).x

.PHONY: localup typescript nodejs-install deps static-analysis

localup: nodejs-install deps static-analysis
	@echo "localup completed"

# WSL 上で Node.js / npm を実行できる環境を構築する
nodejs-install:
	@if ! grep -qiE "(microsoft|wsl)" /proc/version; then \
		echo "Warning: this target is intended for WSL environment."; \
	fi
	@if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then \
		echo "Node.js and npm are already available:"; \
		node -v; \
		npm -v; \
		exit 0; \
	fi
	sudo apt update
	curl -fsSL $(NODESOURCE_SETUP_URL) | sudo -E bash -
	sudo apt install -y nodejs
	sudo npm install -g npm@latest

deps:
	npm install

# TypeScript の静的解析（型チェックのみ）
static-analysis:
	npx tsc -p tsconfig.json --noEmit

typescript_uninstall:
	# npm をアンインストール
	npm cache clean --force --loglevel=error || true && \
	sudo rm -rf /usr/lib/node_modules && \
	sudo apt remove -y nodejs node-typescript || true
	# npm 関連フォルダを削除
	sudo rm -rf ./node_modules && \
	sudo rm -rf ~/.npm && \
	sudo rm -rf /usr/local/bin/npm && \
	sudo rm -rf /usr/local/bin/npx

typescript:
	# Node.js と npm を再インストール
	sudo apt update && \
	curl -fsSL $(NODESOURCE_SETUP_URL) | sudo -E bash - && \
	sudo apt install -y nodejs && \
	sudo npm install -g npm@latest && \
	npm install && \
	sudo chown -R $(CURRENT_UID):$(CURRENT_GID) ./node_modules || true
