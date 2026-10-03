#!/bin/sh
# 在你电脑上跑:把这个 worktree 推到服务器(rsync,不带 .git / node_modules / 数据),装依赖、打前端、重启脑子。
#   sh packaging/hosted/push.sh fairwind@64.23.225.65
set -eu
HOST="${1:?用法:push.sh user@host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENVF="$HOME/.fairwind-hosted.env"
[ -f "$ENVF" ] || { echo "缺 $ENVF"; exit 1; }
URL=$(grep '^SUPABASE_URL=' "$ENVF" | cut -d= -f2-); ANON=$(grep '^SUPABASE_ANON_KEY=' "$ENVF" | cut -d= -f2-)
echo "· 推代码 → $HOST:~/producer-agent"
rsync -az --delete \
  --exclude .git --exclude node_modules --exclude 'brain/node_modules' --exclude dist --exclude '.env*' --exclude 'brain/.env*' \
  --exclude 'packaging/out' --exclude 'packaging/runtime' --exclude 'brain/.supabase-session.json' --exclude 'brain/.mail-tokens.json' \
  --exclude demo --exclude 'src/demo' --exclude 'supabase/demo' --exclude '.claude' \
  "$ROOT/" "$HOST:producer-agent/"
echo "· 前端的环境(云端配置:直连 Supabase,脑子同源)"
printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\n' "$URL" "$ANON" | ssh "$HOST" 'cat > producer-agent/.env.production'
echo "· 脑子的环境 → /etc/fairwind/env(只有 fairwind 和 root 能读)"
grep -E '^(FAIRWIND_MODE|SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|BRAIN_ORIGIN)=' "$ENVF" | ssh "$HOST" 'sudo tee /etc/fairwind/env >/dev/null && sudo chmod 640 /etc/fairwind/env && printf "BRAIN_PORT=8788\nBRAIN_HOST=127.0.0.1\nNODE_ENV=production\n" | sudo tee -a /etc/fairwind/env >/dev/null'
echo "· 服务器上:装依赖、打前端、装 systemd、重启"
ssh "$HOST" 'set -e; export PATH="$HOME/node/bin:$PATH"; cd producer-agent
  npm ci --no-audit --no-fund >/dev/null
  ( cd brain && npm ci --omit=dev --no-audit --no-fund >/dev/null )
  mkdir -p src/demo-empty
  VITE_HOSTED=1 npx vite build >/dev/null
  sudo cp packaging/hosted/fairwind.service /etc/systemd/system/fairwind.service
  sudo systemctl daemon-reload; sudo systemctl enable -q fairwind; sudo systemctl restart fairwind
  sleep 3; curl -sf http://127.0.0.1:8788/health | head -c 160; echo'
echo "✓ 推好了"
