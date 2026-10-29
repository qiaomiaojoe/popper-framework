#!/bin/bash
# 把这个文件夹做成一个 Mac 独立 App（双击就开，不用浏览器、不用开终端）。
# 第一次要先装打包工具（约 100MB+，只装一次），步骤见 说明.md「做成独立 App」。
# 做好的 App 在「打包输出」文件夹里。没有付费签名，只做临时签名。
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
SRC="$(pwd)"
TOOLS="${POPPER_BUILD_TOOLS:-$SRC/node_modules}"   # 打包工具在哪：默认是 npm install 装在这里的那份
OUT="${POPPER_OUT:-$SRC/打包输出}"
ZIP_DIR="${ELECTRON_ZIP_DIR:-}"   # 可选：已经下载好的 Electron 压缩包所在文件夹，填了就一定不联网
if [ ! -x "$TOOLS/.bin/electron-packager" ]; then
  echo "还没装打包工具。先在终端里进入这个文件夹，运行（国内网络用镜像）："
  echo "  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install --registry=https://registry.npmmirror.com"
  echo "装好后再双击「打包App.command」。"
  read -n 1 -s -r -p "按任意键关闭"; exit 1
fi
# 和 npm install 用同一个镜像：Electron 按下载地址存缓存，地址不同就找不到装好的那份、又去 GitHub 下（国内常常下不动）
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
NAME="$(node -p "require('./package.json').productName")"
VERSION="$(node -p "require('./app/version.json').version")"
ELECTRON_VERSION="$(node -p "require('$TOOLS/electron/package.json').version")"
ARCH="$(uname -m)"; [ "$ARCH" = x86_64 ] && ARCH=x64   # Apple 芯片是 arm64，Intel 是 x64

# 1. 只挑要进 App 的文件。开发用的「隔离测试」工作流、测试用假 AI 不带
STAGE="$(mktemp -d)/app"
mkdir -p "$STAGE/app" "$STAGE/content"
for f in main.cjs kernel.cjs preload.cjs version.json; do cp "app/$f" "$STAGE/app/"; done
for f in content/*; do
  if grep -q '"类型":"测试"' "$f" 2>/dev/null || [ "$(basename "$f")" = engine-fake.cjs ]; then continue; fi
  cp "$f" "$STAGE/content/"
done
cat > "$STAGE/package.json" <<JSON
{ "name": "popper-framework", "productName": "$NAME", "version": "$VERSION", "main": "app/main.cjs", "author": "乔淼PhD" }
JSON
# App 要读写「文稿」里的项目文件夹，macOS 会弹窗问一次，这里写弹窗上的说明
cat > "$STAGE/Info-extra.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>NSDocumentsFolderUsageDescription</key><string>$NAME 默认把你的项目放在「文稿」里的 POPPER Framework 文件夹。</string>
  <key>NSDesktopFolderUsageDescription</key><string>你把项目放在桌面时，AI 需要在那里读写文件。</string>
  <key>NSDownloadsFolderUsageDescription</key><string>你把项目放在下载文件夹时，AI 需要在那里读写文件。</string>
</dict></plist>
PLIST

# 2. 打成 .app
"$TOOLS/.bin/electron-packager" "$STAGE" "$NAME" --platform=darwin --arch="$ARCH" --electron-version="$ELECTRON_VERSION" \
  --app-version="$VERSION" --app-copyright="© 2026 乔淼PhD" --out="$OUT" --overwrite --asar --prune=false ${ZIP_DIR:+--electron-zip-dir="$ZIP_DIR"} \
  --icon="$SRC/构建素材/图标.icns" --app-bundle-id=local.popper-framework.app \
  --extend-info="$STAGE/Info-extra.plist" --ignore='Info-extra\.plist'
APP="$OUT/$NAME-darwin-$ARCH/$NAME.app"
# 3. 临时签名：Apple 芯片上一点签名都没有的 App 根本打不开
codesign --force --deep --sign - "$APP"
echo
echo "做好了：$APP"
open -R "$APP"
