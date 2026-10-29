#!/bin/bash
# 双击启动（浏览器版）。只需要 Node.js。用完关掉这个窗口就退出。
cd "$(dirname "$0")"
# 双击打开的终端有时拿不到 Homebrew 的路径，补上常见的几个位置
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"
if ! command -v node >/dev/null 2>&1; then
  echo "没找到 Node.js（这个 App 靠它运行）。装一下，二选一："
  echo "  1. 有 Homebrew 的话，在终端里运行：brew install node"
  echo "  2. 到 https://nodejs.org 下载 LTS 版，双击安装"
  echo "装好后关掉这个窗口，再双击「启动.command」。"
  read -n 1 -s -r -p "按任意键关闭"
  exit 1
fi
echo "Node.js $(node -v)"
node app/kernel.cjs "$@"
