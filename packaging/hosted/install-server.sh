#!/bin/sh
# 服务器上一次性装环境(以 fairwind 用户跑;要 sudo)。装完用 push.sh 推代码。
#   ssh fairwind@<机器> 'sh -s' < packaging/hosted/install-server.sh
set -eu
NODE_VER=24.9.0
ARCH=$(uname -m); case "$ARCH" in x86_64) A=x64;; aarch64) A=arm64;; *) echo "不认识的架构 $ARCH"; exit 1;; esac
cd "$HOME"
if [ ! -x "$HOME/node/bin/node" ]; then
  echo "· 装 node $NODE_VER($A)"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-$A.tar.xz" | tar -xJ
  rm -rf node && mv "node-v$NODE_VER-linux-$A" node
fi
export PATH="$HOME/node/bin:$PATH"
echo "· node $(node -v) npm $(npm -v)"
echo "· apt:expect(setup-token 用)、rsync"
sudo apt-get update -qq && sudo apt-get install -y -qq expect rsync >/dev/null
echo "· 全局 claude(一键登录跑 setup-token)"
npm i -g @anthropic-ai/claude-code >/dev/null 2>&1 || echo "  (claude-code 没装上,一键登录会退回「在终端里跑 setup-token」)"
echo "· 目录"
mkdir -p "$HOME/producer-agent"
sudo mkdir -p /etc/fairwind /var/lib/fairwind
sudo chown fairwind:fairwind /var/lib/fairwind
[ -f /etc/fairwind/env ] || { sudo touch /etc/fairwind/env; sudo chown root:fairwind /etc/fairwind/env; sudo chmod 640 /etc/fairwind/env; }
echo "· Caddy 在不在"; (command -v caddy >/dev/null && caddy version | head -1) || echo "  没有 caddy 命令(可能跑在容器里)"
ls /etc/caddy 2>/dev/null | head -3 || true
echo "✓ 环境好了。接着在你电脑上跑 packaging/hosted/push.sh"
