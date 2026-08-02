#/bin/bash

export COMPOSE_YAML="docker-compose.yml"
export CURRENT_UID=$(id -u)
export CURRENT_GID=$(id -g)
export UID_GID="${CURRENT_UID}:${CURRENT_GID}"

if [ $1 = "typescript" ]; then
    echo "Typescript Initializing..."
    # npm をアンインストール
    npm cache clean --force --loglevel=error || true
    sudo rm -rf /usr/lib/node_modules
    sudo apt remove -y nodejs node-typescript || true
    # npm 関連フォルダを削除
    sudo rm -rf ./node_modules
    sudo rm -rf ~/.npm
    sudo rm -rf /usr/local/bin/npm
    sudo rm -rf /usr/local/bin/npx
    # Node.js と npm を再インストール
    sudo apt update
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt install -y nodejs
    sudo npm install -g npm@latest
    npm install
    # 実行ユーザーに node_modules の所有権を変更
    sudo chown -R ${UID_GID} ./node_modules || true;
fi

if [ $1 = "buildimage" ]; then
    echo "Docker Image Building..."
	docker compose -f ${COMPOSE_YAML} up -d --build
fi

if [ $1 = "cleanimage" ]; then
    echo "Docker Image Cleaning..."
    if [ "$(docker ps -q --filter 'name=retrocpu_emu')" != "" ]; then
        docker rm -f $(docker ps -q --filter 'name=retrocpu_emu')
    fi
    docker images --format '{{.ID}} {{.Repository}}' | awk '/retrocpu_emu|retro-micro-emulator|mn1613-react-calc/ {print $1}' | sort -u | xargs -r docker rmi -f
    docker system prune --volumes --force
    docker builder prune --all --force
    docker system df
fi
