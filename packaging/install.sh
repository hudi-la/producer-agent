#!/bin/sh
# Fairwind 装机(mac)。装机答疑时粘这一行:
#   curl -fsSL <发布位>/install.sh | sh
# 做四件事:按平台下载 zip、解压到 ~/Applications/Fairwind/app-<版本>/、把 current 指过去、
# 在本机生成 ~/Applications/Fairwind.app(一段 sh)。
# 为什么启动器由脚本在本机生成而不是放进 zip:macOS 给浏览器下载的可执行文件打隔离标记、
# 拦未签名的应用;curl 和本机脚本创建的文件没有这个标记,双击就开。以后应用自己下载的更新也没有。
set -e

RELEASE="${FAIRWIND_RELEASE_URL:-https://github.com/hudi-la/fairwind-releases/releases/latest/download}"
ROOT="$HOME/Applications/Fairwind"
APPB="$HOME/Applications/Fairwind.app"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=mac-arm64 ;;
  Darwin-x86_64) PLAT=mac-x64 ;;
  *) echo "这个安装脚本只认 mac。你的是 $(uname -s) $(uname -m)。"; exit 1 ;;
esac

echo "Fairwind 装机 · $PLAT"
mkdir -p "$ROOT" "$HOME/Applications"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "· 看最新版本"
curl -fsSL "$RELEASE/latest.json" -o "$TMP/latest.json"
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$TMP/latest.json" | head -1)"
URL="$(awk -v p="$PLAT" '$0 ~ "\"" p "\"" {f=1} f && /"url"/ {gsub(/.*"url": *"|".*/, ""); print; exit}' "$TMP/latest.json")"
SHA="$(awk -v p="$PLAT" '$0 ~ "\"" p "\"" {f=1} f && /"sha256"/ {gsub(/.*"sha256": *"|".*/, ""); print; exit}' "$TMP/latest.json")"
[ -n "$VER" ] && [ -n "$URL" ] || { echo "latest.json 里没有 $PLAT 的包"; exit 1; }
# 相对 URL(latest.json 里没写 downloadBase 时)按发布位补全
case "$URL" in http*|file*) ;; *) URL="$RELEASE/$(basename "$URL")" ;; esac

if [ -d "$ROOT/app-$VER" ]; then
  echo "· $VER 已经装着,只重建启动器"
else
  echo "· 下载 $VER($URL)"
  curl -fsSL "$URL" -o "$TMP/app.zip"
  if [ -n "$SHA" ]; then
    GOT="$(shasum -a 256 "$TMP/app.zip" | awk '{print $1}')"
    [ "$GOT" = "$SHA" ] || { echo "✗ 下载的包校验不对(要 $SHA,得到 $GOT)"; exit 1; }
    echo "· 校验对上了"
  fi
  echo "· 解压"
  ditto -x -k "$TMP/app.zip" "$TMP/unz"
  rm -rf "$ROOT/app-$VER.partial"; mv "$TMP/unz/Fairwind" "$ROOT/app-$VER.partial"
  mv "$ROOT/app-$VER.partial" "$ROOT/app-$VER"
fi
ln -sfn "app-$VER" "$ROOT/current"

echo "· 生成 $APPB"
mkdir -p "$APPB/Contents/MacOS"
cat > "$APPB/Contents/MacOS/Fairwind" <<'SH'
#!/bin/sh
# 双击 Fairwind.app 就是跑这一行。current 指向哪个版本就跑哪个;更新只换那个指针。
ROOT="$HOME/Applications/Fairwind"
exec "$ROOT/current/node" "$ROOT/current/launcher.cjs"
SH
chmod +x "$APPB/Contents/MacOS/Fairwind"
# 图标:包里带着 Fairwind.icns(顶栏那个「羽」),放进 .app 里
mkdir -p "$APPB/Contents/Resources"
[ -f "$ROOT/current/Fairwind.icns" ] && cp "$ROOT/current/Fairwind.icns" "$APPB/Contents/Resources/Fairwind.icns"
# 本机临时签名(ad-hoc,不用苹果账号):Apple Silicon 对完全没签名的程序有时会拒。
# 这不是公证——真要浏览器下载后双击就开,得有开发者账号(见 packaging/ACCEPTANCE.md)。
codesign --force --sign - "$APPB" >/dev/null 2>&1 || true
cat > "$APPB/Contents/Info.plist" <<'PL'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Fairwind</string>
  <key>CFBundleDisplayName</key><string>Fairwind</string>
  <key>CFBundleIdentifier</key><string>com.hudiworks.fairwind</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>Fairwind</string>
  <key>CFBundleIconFile</key><string>Fairwind</string>
  <key>LSUIElement</key><false/>
</dict></plist>
PL

touch "$APPB"
echo
echo "装好了:$ROOT/current → app-$VER"
echo "以后双击「应用程序」里(你的用户目录下那个 Applications)的 Fairwind 就行。"
[ -n "$FAIRWIND_NO_OPEN" ] || open "$APPB"
