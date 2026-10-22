#!/bin/sh
# 在服务器上以 fairwind 用户跑:拉代码、装依赖、打前端、重启脑子。第一次装机见 README.md。
#   ssh fairwind@<机器> 'sh ~/producer-agent/packaging/hosted/deploy.sh'
set -eu
ROOT="$HOME/producer-agent"
NODE="$HOME/node/bin"
export PATH="$NODE:$PATH"
cd "$ROOT"
echo "· 拉代码"
git pull --ff-only
echo "· 装依赖"
npm ci --omit=dev --no-audit --no-fund >/dev/null
( cd brain && npm ci --omit=dev --no-audit --no-fund >/dev/null )
echo "· 打前端(云端配置:直连 Supabase,脑子同源)"
# .env.production 由装机时写:VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY;VITE_BRAIN_URL 留空 = 同源
npm ci --no-audit --no-fund >/dev/null   # vite 在 devDependencies 里,打完再瘦身也行,现在图省事
npx vite build >/dev/null
echo "· 迁移:脑子起来不跑迁移(那是 supabase db push 的事);看一眼库里记到哪了"
echo "· 重启"
sudo systemctl restart fairwind
sleep 2
curl -sf http://127.0.0.1:8788/health | head -c 200; echo
echo "✓ 完成"
