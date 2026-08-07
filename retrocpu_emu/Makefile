SHELL := /bin/bash

CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)
NODE_MAJOR ?= 24
NODESOURCE_SETUP_URL := https://deb.nodesource.com/setup_$(NODE_MAJOR).x

-include local.mk

.PHONY: install build start dev test clean typescript typescript_uninstall

install:
	npm install

build:
	npm run build

## Electron アプリ起動（ビルド込み）
start:
	npm start

dev:
	npm run dev

test:
	npm test

clean:
	rm -rf node_modules dist coverage

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
