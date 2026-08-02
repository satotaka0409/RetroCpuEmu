FROM node:22-bookworm-slim

WORKDIR /usr/app/ReactEmu

# 依存関係インストール
COPY package.json package-lock.json* ./
RUN npm install

# index.htmlをコピー（bindマウント用のファイルとして事前配置）
COPY src/main/index.html ./src/main/index.html

# 起動スクリプト
RUN mkdir -p /usr/local/src/ReactEmu
COPY <<-'EOF' /usr/local/src/ReactEmu/run.local.sh
#!/bin/sh
# React起動
cd /usr/app/ReactEmu
npm run dev -- --host 0.0.0.0
EOF
RUN chmod +x /usr/local/src/ReactEmu/run.local.sh

CMD ["/usr/local/src/ReactEmu/run.local.sh"]
