SHELL := /bin/bash

CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)
NODE_MAJOR ?= 24
NODESOURCE_SETUP_URL := https://deb.nodesource.com/setup_$(NODE_MAJOR).x

# 個人の設定は local.mk に記載（git 管理外）
-include local.mk

.PHONY: install dev test build preview clean typescript typescript_uninstall

## WSL 上で依存関係を入れる
install:
	npm install

## Vite 開発サーバ（http://127.0.0.1:5173）
dev:
	npm run dev

test:
	npm test

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf node_modules dist coverage

## Node.js / npm を WSL に入れ直して npm install
typescript:
	sudo apt update && \
	curl -fsSL $(NODESOURCE_SETUP_URL) | sudo -E bash - && \
	sudo apt install -y nodejs && \
	sudo npm install -g npm@latest && \
	npm install && \
	sudo chown -R $(CURRENT_UID):$(CURRENT_GID) ./node_modules || true

typescript_uninstall:
	npm cache clean --force --loglevel=error || true
	sudo rm -rf /usr/lib/node_modules
	sudo apt remove -y nodejs node-typescript || true
	sudo rm -rf ./node_modules
	sudo rm -rf ~/.npm
	sudo rm -rf /usr/local/bin/npm
	sudo rm -rf /usr/local/bin/npx
