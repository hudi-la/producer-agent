# 托管装机(一次性,2026-10-02)

机器:公司的 DigitalOcean Droplet(Ubuntu 24.04,Caddy 在门口)。全程以 `fairwind` 用户做,只有 systemd 和 Caddy 那两步要 sudo。

## 1. 机器上
```sh
# 自带 node 24(不用系统的)
cd ~ && curl -fsSL https://nodejs.org/dist/v24.9.0/node-v24.9.0-linux-x64.tar.xz | tar -xJ && mv node-v24.9.0-linux-x64 node
# setup-token 要的
sudo apt-get install -y expect git
# 代码(部署钥匙只读)
git clone git@github.com:hudi-la/producer-agent.git -b workshop-edition ~/producer-agent
# 全局 claude(一键登录跑 setup-token 用;SDK 自带的那份也行,找得到就用)
~/node/bin/npm i -g @anthropic-ai/claude-code
```

## 2. 配置
```sh
sudo mkdir -p /etc/fairwind && sudo cp ~/producer-agent/packaging/hosted/env.example /etc/fairwind/env
sudo chown root:fairwind /etc/fairwind/env && sudo chmod 640 /etc/fairwind/env
sudo nano /etc/fairwind/env          # 填 Supabase 三样 + 域名
cat > ~/producer-agent/.env.production <<EOF2
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon>
EOF2
```

## 3. Supabase(在你电脑上,对着公司给的项目)
```sh
supabase link --project-ref <ref>
supabase db push                      # 0001–0157 一条线,fresh
# 后台:Authentication → Providers → Email:关掉 "Allow new users to sign up";Confirm email 关
# 后台:Authentication → Users → 给三个学员 Add user(邮箱 + 密码)
# 后台:Storage:确认 pursuit-files 桶存在且 private(0044 建的)
```

## 4. 起
```sh
sudo cp ~/producer-agent/packaging/hosted/fairwind.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable fairwind
sh ~/producer-agent/packaging/hosted/deploy.sh
# Caddy:把 Caddyfile.snippet 那一块加进他们的 Caddyfile,然后
sudo systemctl reload caddy
```

## 以后发版
`sh ~/producer-agent/packaging/hosted/deploy.sh`。有新迁移先在你电脑上 `supabase db push`。

## 验收
`node scripts/isolation-brain.mjs`(两个账号互相看不见;要 .env 里的 HOSTED_URL + 两个测试账号);真机走一遍设计稿十三节第 7 条。
