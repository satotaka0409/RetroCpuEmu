SHELL := /bin/bash

COMPOSE_YAML := docker-compose.yml
CURRENT_UID := $(shell id -u)
CURRENT_GID := $(shell id -g)
UID_GID := UID_GID="$(CURRENT_UID):$(CURRENT_GID)"
NODE_MAJOR ?= 24
NODESOURCE_SETUP_URL := https://deb.nodesource.com/setup_$(NODE_MAJOR).x


# 個人の設定はlocal.mkに記載する local.mkはgit管理から除外する
-include local.mk

localup:
	$(UID_GID) docker compose -f $(COMPOSE_YAML) up -d --build

localdown:
	$(UID_GID) docker compose -f $(COMPOSE_YAML) down

cleanimage:
ifneq ("$(shell docker ps -q --filter 'name=dockerdev-cua-1')", "")
	docker rm -f $(shell docker ps -q --filter 'name=dockerdev-cua-1')
endif
ifneq ("$(shell docker images -q campusua_local)", "")
	docker rmi -f $(shell docker images -q campusua_local)
endif
	docker system prune --volumes --force
	docker builder prune --all --force
	docker system df

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
