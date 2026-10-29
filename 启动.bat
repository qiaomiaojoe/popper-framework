@echo off
chcp 65001 >nul
rem 双击启动（浏览器版）。只需要 Node.js。用完关掉这个窗口就退出。
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node app\kernel.cjs %*
pause
exit /b 0

:nonode
echo 没找到 Node.js，这个 App 靠它运行。装一下，二选一：
echo   1. 打开 PowerShell，运行：winget install OpenJS.NodeJS.LTS
echo   2. 到 https://nodejs.org 下载 LTS 版，双击安装
echo 装好后关掉这个窗口，再双击「启动.bat」。
pause
exit /b 1
